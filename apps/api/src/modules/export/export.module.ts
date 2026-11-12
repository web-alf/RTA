import { Controller, Get, Injectable, Module, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import { Db } from '../../db/db.module';
import { CurrentUser, Perm } from '../../common/auth';
import type { AuthUser } from '../../common/auth';
import { canSeeSensitive } from '../../common/mask';

const LEVEL: Record<string, string> = { JUZ30: 'Juz 30', JUZ29: 'Juz 29', JUZ28: 'Juz 28' };

@Injectable()
export class ExportService {
  constructor(private db: Db) {}

  /** PDF daftar santri (kolom = spreadsheet data santri) sesuai scope; kolom sensitif hanya untuk role yang berhak. Setiap ekspor dicatat. */
  async studentsPdf(user: AuthUser, res: Response, branchId?: number, status?: string) {
    const rows = await this.db.many(
      `SELECT s.nis, s.full_name AS name, s.gender, s.birth_place AS "birthPlace", s.birth_date AS "birthDate", b.name AS branch, c.level, s.join_date AS "joinDate", s.status,
              s.registration_note AS "regNote", s.subsidy_label AS subsidy, f.father_name AS father, f.mother_name AS mother, f.wa_phone AS wa, f.address, f.father_job AS "fatherJob", f.mother_job AS "motherJob"
       FROM students s JOIN branches b ON b.id = s.branch_id JOIN classes c ON c.id = s.class_id JOIN families f ON f.id = s.family_id
       WHERE ($1::int[] IS NULL OR s.branch_id = ANY($1)) AND ($2::int IS NULL OR s.branch_id = $2) AND ($3::text IS NULL OR s.status = $3)
       ORDER BY b.name, s.full_name`, [user.branchIds, branchId ? Number(branchId) : null, status || null]);
    await this.db.exec('INSERT INTO export_logs(user_id, report, filters) VALUES ($1,$2,$3)', [user.id, 'santri_pdf', JSON.stringify({ branchId, status })]);
    const sensitive = canSeeSensitive(user);
    const d = (v?: string) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : '');
    // [judul, lebar relatif, nilai, sensitif]
    const all: [string, number, (r: any) => string, boolean][] = [
      ['ID Santri', 42, (r) => r.nis, false], ['Nama Lengkap', 80, (r) => r.name, false], ['JK', 18, (r) => r.gender, false],
      ['Tempat Lahir', 44, (r) => r.birthPlace, false], ['Tgl Lahir', 44, (r) => d(r.birthDate), false], ['Cabang', 46, (r) => r.branch, false],
      ['Jenjang', 34, (r) => LEVEL[r.level] ?? r.level, false], ['Tgl Bergabung', 44, (r) => d(r.joinDate), false], ['Status', 36, (r) => r.status, false],
      ['Ket. Pendaftaran', 56, (r) => r.regNote, false], ['Kategori Subsidi', 42, (r) => r.subsidy, true], ['Nama Ayah', 52, (r) => r.father, false],
      ['Nama Ibu', 52, (r) => r.mother, false], ['No WA Wali', 56, (r) => r.wa, true], ['Alamat', 82, (r) => r.address, true],
      ['Pekerjaan Ayah', 33, (r) => r.fatherJob, true], ['Pekerjaan Ibu', 33, (r) => r.motherJob, true],
    ];
    const cols = all.filter((c) => sensitive || !c[3]);
    const M = 24, W = 842 - 2 * M, scale = W / cols.reduce((a, c) => a + c[1], 0);
    const widths = cols.map((c) => c[1] * scale);
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: M });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="santri-${new Date().toISOString().slice(0, 10)}.pdf"`);
    doc.pipe(res);
    doc.fontSize(14).fillColor('#ad1d8e').text('Rumah Tahfidz Al-Fatihah — Daftar Santri', { continued: false });
    doc.fontSize(9).fillColor('#4f404b').text(`Dicetak ${new Date().toLocaleString('id-ID')} oleh ${user.name}. ${sensitive ? 'Berisi data sensitif: jangan dibagikan ke grup terbuka.' : 'Data sensitif disembunyikan sesuai hak akses.'}`);
    doc.moveDown(0.8);
    const row = (vals: string[], bold = false) => {
      doc.fontSize(6.5).font(bold ? 'Helvetica-Bold' : 'Helvetica');
      const h = Math.max(...vals.map((v, i) => doc.heightOfString(v, { width: widths[i] - 4 }))) + 5;
      if (doc.y + h > 595 - M) { doc.addPage(); if (!bold) row(cols.map((c) => c[0]), true); }
      const y = doc.y; let x = M;
      vals.forEach((v, i) => { doc.fillColor('#1f191e').text(v, x + 2, y + 2, { width: widths[i] - 4 }); x += widths[i]; });
      doc.moveTo(M, y + h).lineTo(M + W, y + h).strokeColor('#d6cdd4').lineWidth(0.5).stroke();
      doc.x = M; doc.y = y + h;
    };
    row(cols.map((c) => c[0]), true);
    for (const r of rows) row(cols.map((c) => String(c[2](r) ?? '')));
    doc.moveDown().font('Helvetica').fontSize(8).fillColor('#6b5766').text(`Total: ${rows.length} santri`, M);
    doc.end();
  }
}

@Controller('export')
export class ExportController {
  constructor(private s: ExportService) {}
  @Get('students.pdf') @Perm('santri.ekspor') students(@CurrentUser() u: AuthUser, @Res() res: Response, @Query('branchId') b?: number, @Query('status') st?: string) { return this.s.studentsPdf(u, res, b, st); }
}

@Module({ controllers: [ExportController], providers: [ExportService] })
export class ExportModule {}
