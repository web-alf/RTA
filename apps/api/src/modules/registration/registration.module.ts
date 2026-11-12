import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { printedBy, rp, sendPdf, sendXlsx } from '../../common/report';
import type { Sheet } from '../../common/report';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Db } from '../../db/db.module';
import { CurrentUser, Perm } from '../../common/auth';
import type { AuthUser } from '../../common/auth';
import { AuditService } from '../../common/audit.service';
import { academicYearStart, addMonthsKeepDay, rupiah, todayWIB } from '../../common/time';
import { SettingsService } from '../settings/settings.module';
import { BillingModule, BillingService } from '../billing/billing.module';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

class PlanDto {
  @IsIn(['LUNAS', 'CICIL'], { message: 'Skema harus lunas langsung atau cicil' }) scheme: 'LUNAS' | 'CICIL';
  @IsOptional() @IsInt() @Min(2) @Max(6) count?: number;                  // jumlah kali bayar termasuk DP
  @IsOptional() @IsInt() @Min(0) dp?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(6) @Matches(DATE, { each: true, message: 'Tanggal jatuh tempo tidak valid' }) dueDates?: string[];
}

/** Status baris per santri (diturunkan dari status tiap tagihan cicilan, tidak disimpan) */
function rowStatus(inst: { status: string }[], paid: number) {
  if (inst.every((i) => i.status === 'LUNAS')) return 'LUNAS';
  if (inst.some((i) => i.status === 'TUNGGAKAN')) return 'TERLAMBAT';
  if (inst.some((i) => i.status === 'MENUNGGU')) return 'MENUNGGU';
  return paid > 0 ? 'CICILAN' : 'BELUM_BAYAR';
}
const ORDER = ['TERLAMBAT', 'BELUM_BAYAR', 'MENUNGGU', 'CICILAN', 'LUNAS'];

@Injectable()
export class RegistrationService {
  constructor(private db: Db, private audit: AuditService, private settings: SettingsService, private billing: BillingService) {}

  /** Tagihan pendaftaran santri yang bergabung di tahun pembelajaran berjalan (scope cabang). */
  async list(user: AuthUser, branchId?: number) {
    const scope = branchId ? (user.branchIds ? user.branchIds.filter((b) => b === Number(branchId)) : [Number(branchId)]) : user.branchIds; // filter cabang (dashboard), tetap di dalam scope
    const cfg = await this.settings.get();
    const start = academicYearStart(cfg.academicYearStartMonth);
    const { sql } = this.billing.invoicesSql(`WHERE type = 'PENDAFTARAN' AND ($1::int[] IS NULL OR branch_id = ANY($1))
      AND student_id IN (SELECT id FROM students WHERE join_date >= $2) ORDER BY COALESCE(due_date, period), installment_no NULLS FIRST, id`);
    const inv = await this.db.many(sql, [scope, start]);
    const ids = [...new Set(inv.map((i) => i.student_id))];
    const st = ids.length ? await this.db.many(
      `SELECT s.id, s.nis, s.full_name, s.nickname, s.status, s.join_date, s.family_id, b.name AS branch, c.name AS class, f.father_name
       FROM students s JOIN branches b ON b.id = s.branch_id JOIN classes c ON c.id = s.class_id JOIN families f ON f.id = s.family_id WHERE s.id = ANY($1)`, [ids]) : [];
    // pembayaran terakhir per tagihan (tanggal & cara bayar untuk jadwal); dibatalkan/ditolak tidak dihitung
    const pays = inv.length ? await this.db.many(
      `SELECT DISTINCT ON (a.invoice_id) a.invoice_id, p.paid_at, p.method, p.state FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
       WHERE a.invoice_id = ANY($1) AND p.state IN ('TERVERIFIKASI', 'MENUNGGU') ORDER BY a.invoice_id, p.paid_at DESC, p.id DESC`, [inv.map((i) => i.id)]) : [];
    const rows = st.map((s) => {
      const mine = inv.filter((i) => i.student_id === s.id);
      const total = mine[0]?.installment_total ?? null;
      const fee = mine.reduce((a, i) => a + i.amount, 0), paid = mine.reduce((a, i) => a + i.paid_ok, 0), pending = mine.reduce((a, i) => a + i.paid_pending, 0);
      const installments = mine.map((i, k) => {
        const p = pays.find((x) => x.invoice_id === i.id);
        return { id: i.id, no: i.installment_no ?? k + 1, label: i.label, amount: i.amount, dueDate: i.due_date, status: i.status, paidAt: p?.paid_at ?? null, method: p?.method ?? null };
      });
      const next = installments.find((i) => !['LUNAS', 'MENUNGGU'].includes(i.status));
      return {
        studentId: s.id, nis: s.nis, fullName: s.full_name, nickname: s.nickname, studentStatus: s.status, joinDate: s.join_date,
        branchName: s.branch, className: s.class, familyId: s.family_id, familyName: s.father_name,
        scheme: total == null ? 'BELUM_DIATUR' : total === 1 ? 'LUNAS' : 'CICIL', count: total ?? 1,
        fee, paid, pending, sisa: fee - paid, paidCount: installments.filter((i) => i.status === 'LUNAS').length,
        status: rowStatus(installments, paid), next: next ? { id: next.id, no: next.no, amount: next.amount, dueDate: next.dueDate, status: next.status } : null,
        installments,
      };
    }).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.fullName.localeCompare(b.fullName));
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    return {
      yearStart: start, minDp: cfg.registrationMinDp, maxInstallments: cfg.registrationMaxInstallments,
      summary: { total: rows.length, lunas: count('LUNAS'), cicilan: rows.filter((r) => r.scheme === 'CICIL' && r.status !== 'LUNAS').length,
        terlambat: count('TERLAMBAT'), belumBayar: count('BELUM_BAYAR'), menunggu: count('MENUNGGU'),
        target: rows.reduce((a, r) => a + r.fee, 0), terkumpul: rows.reduce((a, r) => a + r.paid, 0), diperiksa: rows.reduce((a, r) => a + r.pending, 0) },
      rows,
    };
  }

  /** Ekspor menu Pendaftaran (Excel/PDF): ringkasan per santri + jadwal cicilan. Scope cabang dari list(). */
  async exportReport(user: AuthUser, res: Response, fmt: 'xlsx' | 'pdf') {
    const d = await this.list(user);
    await this.db.exec('INSERT INTO export_logs(user_id, report, filters) VALUES ($1,$2,$3)', [user.id, `pendaftaran_${fmt}`, JSON.stringify({ yearStart: d.yearStart })]);
    const yr = Number(String(d.yearStart).slice(0, 4));
    const SCHEME: Record<string, string> = { BELUM_DIATUR: 'Belum diatur', LUNAS: 'Lunas langsung', CICIL: 'Cicil' };
    const STATUS: Record<string, string> = { TERLAMBAT: 'Terlambat', BELUM_BAYAR: 'Belum bayar', MENUNGGU: 'Menunggu verifikasi', CICILAN: 'Cicilan berjalan', LUNAS: 'Lunas' };
    const INST: Record<string, string> = { LUNAS: 'Lunas', MENUNGGU: 'Menunggu verifikasi', BELUM: 'Belum bayar', TUNGGAKAN: 'Terlambat', TERJADWAL: 'Terjadwal' };
    const s = d.summary;
    const meta = {
      title: `Laporan Pendaftaran — tahun pembelajaran ${yr}/${yr + 1}`,
      subtitle: `Rumah Tahfidz Al-Fatihah · ${user.branchIds ? 'cabang Anda' : 'semua cabang'} · ${printedBy(user.name)}`,
      summary: [['Santri baru', String(s.total)], ['Lunas', String(s.lunas)], ['Cicilan berjalan', String(s.cicilan)], ['Terlambat', String(s.terlambat)],
        ['Target', rp(s.target)], ['Terkumpul (terverifikasi)', rp(s.terkumpul)], ['Menunggu verifikasi', rp(s.diperiksa)], ['Sisa', rp(s.target - s.terkumpul)]] as [string, string][],
    };
    const sheets: Sheet[] = [
      { name: 'Pendaftaran', columns: [
          { header: 'No', key: 'no', width: 5 }, { header: 'ID santri', key: 'nis', width: 13 }, { header: 'Nama santri', key: 'fullName', width: 26 }, { header: 'Cabang', key: 'branchName', width: 13 },
          { header: 'Kelas', key: 'className', width: 12 }, { header: 'Wali', key: 'familyName', width: 20 }, { header: 'Tgl bergabung', key: 'joinDate', width: 12, date: true },
          { header: 'Skema', key: 'scheme', width: 13 }, { header: 'Biaya', key: 'fee', width: 13, money: true }, { header: 'Terbayar', key: 'paid', width: 13, money: true },
          { header: 'Menunggu', key: 'pending', width: 12, money: true }, { header: 'Sisa', key: 'sisa', width: 13, money: true }, { header: 'Status', key: 'status', width: 15 }, { header: 'Berikutnya', key: 'next', width: 24 }],
        rows: d.rows.map((r, k) => ({ ...r, no: k + 1, scheme: r.scheme === 'CICIL' ? `Cicil ${r.count}×` : SCHEME[r.scheme], status: STATUS[r.status] ?? r.status,
          next: r.next ? `${r.count > 1 ? (r.next.no === 1 ? 'DP' : `Cicilan ${r.next.no}`) : 'Pendaftaran'} ${rp(r.next.amount)}${r.next.dueDate ? ` · ${String(r.next.dueDate).slice(0, 10)}` : ''}` : '-' })),
        totals: { fullName: 'Total', fee: s.target, paid: s.terkumpul, pending: s.diperiksa, sisa: d.rows.reduce((a, r) => a + r.sisa, 0) } },
      { name: 'Jadwal cicilan', columns: [
          { header: 'Nama santri', key: 'fullName', width: 26 }, { header: 'Cabang', key: 'branchName', width: 13 }, { header: 'Ke', key: 'no', width: 5 }, { header: 'Tagihan', key: 'label', width: 24 },
          { header: 'Nominal', key: 'amount', width: 13, money: true }, { header: 'Jatuh tempo', key: 'dueDate', width: 12, date: true }, { header: 'Status', key: 'status', width: 16 },
          { header: 'Tgl bayar', key: 'paidAt', width: 12, date: true }, { header: 'Cara bayar', key: 'method', width: 11 }],
        rows: d.rows.flatMap((r) => r.installments.map((i: any) => ({ ...i, fullName: r.fullName, branchName: r.branchName, status: INST[i.status] ?? i.status, method: i.method ? (i.method === 'TUNAI' ? 'Tunai' : 'Transfer') : '' }))) },
    ];
    const file = `pendaftaran-${yr}-${yr + 1}`;
    if (fmt === 'xlsx') return sendXlsx(res, file, meta, sheets);
    sendPdf(res, file, meta, sheets, { landscape: true, footnote: 'Hanya tagihan pendaftaran santri baru tahun pembelajaran ini. SPP & daftar ulang ada di laporan menu SPP.' });
  }

  /**
   * Atur skema pembayaran pendaftaran (PJ). Tagihan lama dibatalkan (voided, tidak dihapus) dan diganti:
   * LUNAS = satu tagihan; CICIL = DP + sisa dibagi rata (kelipatan Rp1.000, cicilan terakhir menyerap selisih), jatuh tempo per bulan.
   * Hanya selama belum ada pembayaran (terverifikasi/menunggu) agar riwayat bayar tidak berubah.
   */
  async plan(user: AuthUser, studentId: number, dto: PlanDto) {
    const s = await this.db.one('SELECT id, full_name FROM students WHERE id = $1 AND ($2::int[] IS NULL OR branch_id = ANY($2))', [studentId, user.branchIds]);
    if (!s) throw new NotFoundException('Santri tidak ditemukan');
    const { sql } = this.billing.invoicesSql(`WHERE student_id = $1 AND type = 'PENDAFTARAN' ORDER BY COALESCE(due_date, period), id`);
    const old = await this.db.many(sql, [studentId]);
    if (!old.length) throw new BadRequestException('Santri ini tidak punya tagihan pendaftaran');
    if (old.some((i) => i.paid_ok > 0 || i.paid_pending > 0))
      throw new BadRequestException('Sudah ada pembayaran pendaftaran, skema tidak bisa diubah lagi. Cicilan berikutnya cukup dicatat atau dilunasi.');
    const cfg = await this.settings.get();
    const fee = old.reduce((a, i) => a + i.amount, 0);
    const today = todayWIB();
    let items: { amount: number; dueDate: string | null }[];
    if (dto.scheme === 'LUNAS') {
      items = [{ amount: fee, dueDate: dto.dueDates?.[0] ?? null }];
    } else {
      const n = dto.count ?? 0, dp = dto.dp ?? 0, max = cfg.registrationMaxInstallments, min = cfg.registrationMinDp;
      if (max < 2 || fee <= min) throw new BadRequestException(`Biaya pendaftaran ${rupiah(fee)} tidak bisa dicicil. Pilih lunas langsung.`);
      if (n < 2 || n > max) throw new BadRequestException(`Cicilan 2 sampai ${max} kali (termasuk DP)`);
      if (dp < min) throw new BadRequestException(`DP minimal ${rupiah(min)}. Naikkan DP atau pilih lunas langsung.`);
      if (dp >= fee) throw new BadRequestException('DP sama dengan atau melebihi biaya pendaftaran. Pilih lunas langsung.');
      const rest = fee - dp, each = Math.floor(rest / (n - 1) / 1000) * 1000;
      if (each <= 0) throw new BadRequestException(`Sisa ${rupiah(rest)} terlalu kecil untuk dibagi ${n - 1} kali. Kurangi jumlah cicilan atau naikkan DP.`);
      const amounts = [dp, ...Array(n - 2).fill(each), rest - each * (n - 2)];
      const dates = dto.dueDates?.length ? dto.dueDates : amounts.map((_, k) => addMonthsKeepDay(today, k));
      if (dates.length !== n) throw new BadRequestException(`Isi ${n} tanggal jatuh tempo`);
      for (let k = 1; k < n; k++) if (dates[k].slice(0, 7) <= dates[k - 1].slice(0, 7)) throw new BadRequestException('Jatuh tempo tiap cicilan harus di bulan yang berbeda dan berurutan');
      items = amounts.map((amount, k) => ({ amount, dueDate: dates[k] }));
    }
    const n = items.length;
    const label = (k: number) => (n === 1 ? 'Pendaftaran' : k === 0 ? 'Pendaftaran · DP' : `Pendaftaran · Cicilan ${k + 1}`);
    const created = await this.db.tx(async (c) => {
      await c.query(`UPDATE invoices SET voided_at = now(), void_reason = 'Diganti skema pembayaran pendaftaran' WHERE id = ANY($1)`, [old.map((i) => i.id)]);
      const out: { id: number; no: number; amount: number; dueDate: string | null }[] = [];
      for (const [k, it] of items.entries()) {
        // periode = bulan jatuh tempo (indeks unik per santri/jenis/periode); tanpa jatuh tempo = periode lama
        const period = it.dueDate ? it.dueDate.slice(0, 8) + '01' : old[0].period;
        const r = (await c.query(`INSERT INTO invoices(student_id, family_id, branch_id, type, period, label, amount, due_date, installment_no, installment_total)
          VALUES ($1,$2,$3,'PENDAFTARAN',$4,$5,$6,$7,$8,$9) RETURNING id`, [studentId, old[0].family_id, old[0].branch_id, period, label(k), it.amount, it.dueDate, k + 1, n])).rows[0];
        out.push({ id: r.id, no: k + 1, amount: it.amount, dueDate: it.dueDate });
      }
      await this.audit.log(user.id, 'atur_skema_pendaftaran', 'student', studentId,
        { invoices: old.map((i) => ({ id: i.id, label: i.label, amount: i.amount, dueDate: i.due_date })) },
        { scheme: dto.scheme, invoices: out }, c);
      return out;
    });
    return { scheme: dto.scheme, invoices: created };
  }
}

@Controller('registrations')
export class RegistrationController {
  constructor(private s: RegistrationService) {}
  @Get() @Perm('pendaftaran.lihat') list(@CurrentUser() u: AuthUser) { return this.s.list(u); }
  @Get('export.xlsx') @Perm('pendaftaran.ekspor') xlsx(@CurrentUser() u: AuthUser, @Res() res: Response) { return this.s.exportReport(u, res, 'xlsx'); }
  @Get('export.pdf') @Perm('pendaftaran.ekspor') pdf(@CurrentUser() u: AuthUser, @Res() res: Response) { return this.s.exportReport(u, res, 'pdf'); }
  @Post(':studentId/plan') @Perm('pendaftaran.edit') plan(@CurrentUser() u: AuthUser, @Param('studentId', ParseIntPipe) id: number, @Body() dto: PlanDto) { return this.s.plan(u, id, dto); }
}

@Module({ imports: [BillingModule], controllers: [RegistrationController], providers: [RegistrationService, AuditService], exports: [RegistrationService] })
export class RegistrationModule {}
