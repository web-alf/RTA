import { BadRequestException, Controller, Get, Injectable, Module, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { Db } from '../../db/db.module';
import type { PoolClient } from 'pg';
import { CurrentUser, Perm } from '../../common/auth';
import type { AuthUser } from '../../common/auth';
import { AuditService } from '../../common/audit.service';
import { StudentsModule } from '../students/students.module';
import { NIS_RULE, StudentsService } from '../students/students.service';
import { FamiliesModule, FamiliesService, PHONE_RULE } from '../families/families.module';
import { SubsidiesService } from '../subsidies/subsidies.module';

// Kolom = spreadsheet data santri. Wajib: ID Santri (dipakai sebagai ID resmi), Nama Lengkap, Jenis Kelamin, Cabang, Jenjang,
// Status, Keterangan Pendaftaran. Kolom lain boleh kosong (migrasi 015/016) dan dilengkapi kemudian;
// Tanggal Bergabung kosong = santri lama (migrasi 016).
const TEMPLATE = 'ID Santri,Nama Lengkap,Jenis Kelamin,Tempat Lahir,Tanggal Lahir,Cabang,Jenjang,Tanggal Bergabung,Status,Keterangan Pendaftaran,Kategori Subsidi,Nama Ayah,Nama Ibu,No WA Wali,Alamat,Pekerjaan Ayah,Pekerjaan Ibu\n' +
  'RTA-SPY-001,Aisyah Putri,P,Semarang,2017-03-04,Supriyadi,JUZ30,2026-07-01,AKTIF,Daftar lewat WhatsApp,,Rahmat,Siti,081234567890,"Jl. Contoh No. 1, Semarang",Wiraswasta,Ibu rumah tangga\n';
const STATUSES = ['INDENT', 'AKTIF', 'CUTI', 'KELUAR'];
// Header dinormalkan ("No WA Wali" -> no_wa_wali); nama kolom template lama tetap diterima
const HEADER_ALIAS: Record<string, string> = { jk: 'jenis_kelamin', tgl_lahir: 'tanggal_lahir', tgl_masuk: 'tanggal_bergabung', no_wa: 'no_wa_wali' };
const normHeader = (h: string) => { const k = h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); return HEADER_ALIAS[k] ?? k; };
/** YYYY-MM-DD, atau DD/MM/YYYY & DD-MM-YYYY (format umum Excel/Google Sheets Indonesia) -> YYYY-MM-DD */
const isoDate = (v = '') => { const t = v.trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t; const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
const GENDER: Record<string, string> = { l: 'L', p: 'P', 'laki-laki': 'L', 'laki laki': 'L', perempuan: 'P' };
// Pemetaan nama cabang lama dari spreadsheet (lihat prd.md IMP-3)
const BRANCH_ALIAS: Record<string, string> = { 'pedurungan 1': 'Supriyadi', 'pedurungan 2': 'Pedurungan' };
const MAX_ROWS = 2000;
type RawRow = { row: number; data: Record<string, string> };
/** Dilempar di akhir "Periksa dulu" / bila ada baris gagal agar seluruh transaksi impor dibatalkan. */
class Rollback { constructor(readonly result: any) {} }

/** Isi sel xlsx -> teks. Sel tanggal -> YYYY-MM-DD; no. WA yang tersimpan sebagai angka (0 di depan hilang) dikembalikan ke 08…. */
function cellText(v: ExcelJS.CellValue, key: string): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10); // exceljs: tanggal Excel = tengah malam UTC
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('formula' in v || 'sharedFormula' in v) return cellText((v as any).result ?? null, key);
    if ('text' in v) return String(v.text); // hyperlink
    return ''; // sel error
  }
  const t = String(v);
  return key === 'no_wa_wali' && typeof v === 'number' && /^8\d{7,12}$/.test(t) ? '0' + t : t;
}

/** Baca CSV atau xlsx (dikenali dari isi file, bukan ekstensi). Hasil: header dinormalkan + nomor baris asli. */
async function readRows(buf: Buffer): Promise<RawRow[]> {
  if (buf.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) throw new BadRequestException('Format .xls lama belum didukung. Simpan ulang sebagai .xlsx atau CSV.');
  if (!buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    const parsed = Papa.parse<Record<string, string>>(buf.toString('utf8'), { header: true, skipEmptyLines: true, transformHeader: normHeader });
    return parsed.data.map((data, i) => ({ row: i + 2, data })); // baris 1 = header
  }
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as any); } catch { throw new BadRequestException('File xlsx tidak bisa dibaca. Simpan ulang dari Excel/Google Sheets lalu coba lagi.'); }
  const ws = wb.worksheets[0];
  if (!ws) throw new BadRequestException('File xlsx tidak memiliki sheet');
  if (ws.rowCount > MAX_ROWS + 1) throw new BadRequestException(`Maksimal ${MAX_ROWS} baris per file`);
  const head: string[] = [];
  ws.getRow(1).eachCell((c, col) => { head[col] = normHeader(cellText(c.value, '')); });
  const out: RawRow[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const data: Record<string, string> = {};
    r.eachCell((c, col) => { const k = head[col]; const t = k ? cellText(c.value, k).trim() : ''; if (t) data[k] = t; });
    if (Object.keys(data).length) out.push({ row: n, data }); // baris kosong dilewati
  });
  return out;
}

/** Template xlsx: kolom tanggal & no. WA berformat teks agar 0 di depan dan format tanggal tidak diubah Excel. */
async function templateXlsx() {
  const [head, sample] = Papa.parse<string[]>(TEMPLATE, { skipEmptyLines: true }).data;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data santri');
  ws.addRow(head).font = { bold: true };
  ws.addRow(sample);
  head.forEach((h, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(14, h.length + 4);
    if (/Tanggal|No WA/.test(h)) col.numFmt = '@';
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

@Injectable()
export class ImportService {
  constructor(private db: Db, private students: StudentsService, private fam: FamiliesService, private audit: AuditService, private subsidies: SubsidiesService) {}

  /**
   * Tahap 1: validasi format per baris. Tahap 2: simpan semua baris dalam SATU transaksi (savepoint per baris agar semua
   * error terkumpul dengan nomor barisnya). "Periksa dulu" menjalankan tahap 2 yang sama lalu rollback, jadi aturan
   * yang butuh database (santri ganda, syarat diskon saudara, keluarga dengan no. WA sama) ikut diperiksa.
   * Ada satu baris gagal → tidak ada yang tersimpan.
   */
  async importStudents(user: AuthUser, buf: Buffer, dryRun: boolean) {
    const parsed = await readRows(buf);
    if (parsed.length > MAX_ROWS) throw new BadRequestException(`Maksimal ${MAX_ROWS} baris per file`);
    const bs = await this.db.many('SELECT id, name FROM branches WHERE is_active');
    const codes = new Set((await this.db.many('SELECT code FROM branches')).map((x) => x.code)); // ID lama boleh berkode cabang nonaktif (cabang pendaftaran)
    const seenNis = new Map<string, number>(); // ID ganda di dalam file
    const cs = await this.db.many('SELECT id, branch_id AS "branchId", level FROM classes');
    const subs = await this.subsidies.list();
    const errors: { row: number; message: string }[] = [];
    const rows: any[] = [];
    parsed.forEach(({ row, data: raw }) => {
      const r: Record<string, string> = {}; for (const [k, v] of Object.entries(raw)) r[k] = (v ?? '').trim();
      const bname = BRANCH_ALIAS[(r.cabang ?? '').toLowerCase()] ?? (r.cabang ?? '');
      const b = bs.find((x) => x.name.toLowerCase() === bname.toLowerCase());
      const c = b && cs.find((x) => x.branchId === b.id && x.level === (r.jenjang ?? '').toUpperCase().replace(/\s+/g, ''));
      const gender = GENDER[(r.jenis_kelamin ?? '').toLowerCase()];
      const birthDate = isoDate(r.tanggal_lahir), joinDate = isoDate(r.tanggal_bergabung);
      const status = (r.status ?? '').toUpperCase();
      const nis = (r.id_santri ?? '').toUpperCase().replace(/\s+/g, '');
      const phone = (r.no_wa_wali ?? '').replace(/[\s-]/g, '');
      const err = (m: string) => errors.push({ row, message: m });
      // --- wajib ---
      const nisMatch = nis.match(NIS_RULE);
      if (!nis) err('ID Santri kosong');
      else if (!nisMatch) err(`ID Santri "${r.id_santri}" harus berformat RTA-<kode cabang>-<nomor>, mis. RTA-GNK-001`);
      else if (!codes.has(nisMatch[1])) err(`Kode cabang "${nisMatch[1]}" pada ID Santri tidak dikenal. Pilihan: ${[...codes].join(', ')}`);
      else if (seenNis.has(nis)) err(`ID Santri ${nis} sama dengan baris ${seenNis.get(nis)}`);
      else seenNis.set(nis, row);
      if (!r.nama_lengkap) err('Nama Lengkap kosong');
      if (!gender) err('Jenis Kelamin harus L atau P');
      if (!r.keterangan_pendaftaran) err('Keterangan Pendaftaran kosong');
      // --- opsional, tapi bila diisi formatnya harus benar ---
      if (r.tanggal_lahir && !birthDate) err('Tanggal Lahir harus YYYY-MM-DD atau DD/MM/YYYY (atau kosongkan)');
      // kosong = santri lama (mengulang / lupa kapan bergabung): tanpa tagihan pendaftaran, tetap ikut SPP & absensi
      if (r.tanggal_bergabung && !joinDate) err('Tanggal Bergabung harus YYYY-MM-DD atau DD/MM/YYYY (atau kosongkan untuk santri lama)');
      if (!b) err(`Cabang "${r.cabang ?? ''}" tidak dikenal`);
      else if (user.branchIds && !user.branchIds.includes(b.id)) err(`Cabang "${b.name}" di luar hak akses Anda`);
      if (b && !c) err(`Jenjang "${r.jenjang ?? ''}" tidak tersedia di cabang ${b.name}`);
      // "Reguler" (baris tarif standar di Pengaturan) / "Tanpa subsidi" / "-" = tanpa subsidi
      if (/^(reguler|tanpa subsidi|-)$/i.test(r.kategori_subsidi?.trim() ?? '')) r.kategori_subsidi = '';
      if (!status) err('Status kosong (isi INDENT, AKTIF, CUTI, atau KELUAR)');
      else if (!STATUSES.includes(status)) err('Status harus INDENT, AKTIF, CUTI, atau KELUAR');
      if (r.kategori_subsidi && !user.perms.includes('spp.input')) err('Kategori Subsidi hanya boleh diisi PJ RTA; kosongkan kolom ini');
      const sub = r.kategori_subsidi ? subs.find((x) => x.isActive && x.name.toLowerCase() === r.kategori_subsidi.toLowerCase()) : undefined;
      if (r.kategori_subsidi && !sub) err(`Kategori Subsidi "${r.kategori_subsidi}" tidak dikenal. Pilihan: Reguler (kosong), ${subs.filter((x) => x.isActive).map((x) => x.name).join(', ')}`);
      else if (sub && b && !sub.rates.some((x: any) => x.branchId === b.id && x.available)) err(`Subsidi "${sub.name}" tidak berlaku di cabang ${b.name}`);
      if (phone && !PHONE_RULE.test(phone)) err('No WA Wali tidak valid (awali 08 atau +62, atau kosongkan)');
      // tanpa no. WA: keluarga baru sendiri (tidak dicocokkan dengan saudara), link tagihan baru bisa dikirim setelah nomornya diisi
      if (nisMatch && b && c && gender && (joinDate || !r.tanggal_bergabung)) rows.push({ row, nis, sibling: !!sub?.isSibling, fullName: r.nama_lengkap, nickname: r.nama_panggilan || undefined, gender,
        birthPlace: r.tempat_lahir || undefined, birthDate: birthDate ?? undefined,
        school: r.sekolah || undefined, branchId: b.id, classId: c.id, joinDate: joinDate ?? undefined, status, registrationNote: r.keterangan_pendaftaran, subsidyId: sub?.id,
        family: { fatherName: r.nama_ayah || undefined, motherName: r.nama_ibu || undefined, waPhone: phone || undefined, address: r.alamat || undefined,
          fatherJob: r.pekerjaan_ayah || undefined, motherJob: r.pekerjaan_ibu || undefined } });
    });
    if (errors.length) return { ok: false, total: parsed.length, valid: parsed.length - new Set(errors.map((e) => e.row)).size, errors };
    try {
      return await this.db.tx(async (c) => {
        const step = async (row: number, fn: () => Promise<void>) => {
          await c.query('SAVEPOINT baris');
          try { await fn(); await c.query('RELEASE SAVEPOINT baris'); }
          catch (e: any) { await c.query('ROLLBACK TO SAVEPOINT baris'); errors.push({ row, message: this.message(e) }); }
        };
        const created: { row: number; id: number; nis: string; familyId: number }[] = [];
        for (const { row, nis, sibling, ...r } of rows) await step(row, async () => {
          // keluarga yang sudah ada (no. WA sama, termasuk dari baris sebelumnya di file ini) dipakai ulang
          if (r.family.waPhone) {
            const lookup = await this.fam.lookup(user, r.family.waPhone, c);
            if (lookup.found && !lookup.inScope) throw new BadRequestException(lookup.message);
            if (lookup.found && lookup.family) { r.familyId = lookup.family.id; delete r.family; }
          }
          // kategori diskon saudara dipasang setelah baris tersimpan, persis sesuai file (lihat assignSubsidy)
          created.push({ row, ...(await this.students.create(user, sibling ? { ...r, subsidyId: undefined } : r, c, { nis })) });
        });
        for (const r of rows.filter((x) => x.sibling)) {
          const s = created.find((x) => x.row === r.row);
          if (s) await step(r.row, () => this.assignSubsidy(user, c, s, r));
        }
        if (errors.length) throw new Rollback({ ok: false, total: parsed.length, valid: parsed.length - new Set(errors.map((e) => e.row)).size, errors: errors.sort((a, b) => a.row - b.row) });
        if (dryRun) throw new Rollback({ ok: true, dryRun: true, total: rows.length, errors: [] });
        await this.audit.log(user.id, 'import', 'student', null, null, { count: created.length }, c);
        return { ok: true, total: created.length, nis: created.map((x) => x.nis), errors: [] };
      });
    } catch (e) {
      if (e instanceof Rollback) return e.result;
      throw e;
    }
  }

  /**
   * Kategori diskon saudara dari file impor dipasang apa adanya: tanpa syarat saudara Aktif (data lama boleh saudaranya
   * sudah lulus) dan saudara lain tidak ikut diubah. Kolom Reguler/kosong tetap Reguler.
   */
  private async assignSubsidy(user: AuthUser, c: PoolClient, s: { id: number; familyId: number }, r: any) {
    const sub = await this.subsidies.resolve(r.subsidyId, r.branchId, { familyId: s.familyId, studentId: s.id, skipSibling: true }, c);
    await c.query('UPDATE students SET spp_rate = $2, subsidy_label = $3, subsidy_id = $4, subsidy_since = $5 WHERE id = $1', [s.id, sub.amount, sub.name, r.subsidyId, sub.since]);
    await this.audit.log(user.id, 'update', 'student', s.id, null, { subsidyLabel: sub.name, sppRate: sub.amount, sumber: 'impor' }, c);
  }

  private message(e: any) {
    if (e instanceof BadRequestException) { const m = (e.getResponse() as any)?.message; return Array.isArray(m) ? m.join(', ') : String(m ?? e.message); }
    if (e?.code === '23505') return 'Data ganda (sudah ada di database atau di baris lain file ini)';
    console.error('impor santri: baris gagal', e?.code ?? e?.message); // tanpa data pribadi
    return 'Baris tidak bisa disimpan. Periksa isinya atau hubungi admin.';
  }
}

@Controller('import')
export class ImportController {
  constructor(private s: ImportService) {}
  @Get('students/template') @Perm('santri.impor') async template(@Res() res: Response, @Query('format') format?: string) {
    if (format === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="template-santri.xlsx"');
      return res.send(await templateXlsx());
    }
    res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', 'attachment; filename="template-santri.csv"'); res.send(TEMPLATE);
  }
  @Post('students') @Perm('santri.impor') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  upload(@CurrentUser() u: AuthUser, @UploadedFile() file?: Express.Multer.File, @Query('dryRun') dry?: string) {
    if (!file) throw new BadRequestException('File CSV atau Excel (.xlsx) wajib diunggah');
    return this.s.importStudents(u, file.buffer, dry === 'true');
  }
}

@Module({ imports: [StudentsModule, FamiliesModule], controllers: [ImportController], providers: [ImportService, AuditService] })
export class ImportModule {}
