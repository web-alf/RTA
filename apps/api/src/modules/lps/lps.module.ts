import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsObject, IsOptional, IsString, Matches } from 'class-validator';
import { createHash, randomBytes } from 'crypto';
import type { Response } from 'express';
import { Db } from '../../db/db.module';
import type { AuthUser } from '../../common/auth';
import { CurrentUser, Perm, Public } from '../../common/auth';
import { AuditService } from '../../common/audit.service';
import { SENSITIVE_ROLES } from '../../common/permissions';
import { monthLabel, monthStart } from '../../common/time';
import { SettingsService, renderWa } from '../settings/settings.module';
import { renderLpsPdf } from './lps-pdf';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const ASPEK = ['BTQ', 'Tahsin', 'Adab', 'Doa harian'];
export const NILAI = ['Sangat baik', 'Baik', 'Perlu latihan'];
const FLOW: Record<string, [string, string, string]> = { // aksi: [dari, ke, izin]
  submit: ['DRAFT', 'DIPERIKSA', 'lps.edit'], approve: ['DIPERIKSA', 'DISETUJUI', 'lps.setujui'], publish: ['DISETUJUI', 'TERBIT', 'lps.setujui'],
};

class GenDto { @Matches(/^\d{4}-\d{2}$/) period: string; @IsOptional() classId?: number; }
class UpdDto { @IsOptional() @IsObject() scores?: Record<string, string>; @IsOptional() @IsString() note?: string; }
class ReviseDto { @IsString() note: string; }

@Injectable()
export class LpsService {
  constructor(private db: Db, private audit: AuditService, private settings: SettingsService) {}
  private ids(u: AuthUser, b?: number) { return u.branchIds ? (b ? u.branchIds.filter((x) => x === Number(b)) : u.branchIds) : b ? [Number(b)] : null; }

  async list(user: AuthUser, p: { period?: string; status?: string; q?: string; branchId?: number }) {
    const period = (p.period ?? monthStart().slice(0, 7)) + '-01';
    const ids = this.ids(user, p.branchId);
    const rows = await this.db.many(
      `SELECT s.id AS "studentId", s.full_name AS "fullName", s.nis, c.name AS "className", b.id AS "branchId", b.name AS "branchName",
              r.id, COALESCE(r.status, 'BELUM') AS status, r.scores, r.note, r.hafalan_percent::float AS "hafalanPercent", r.hafalan_position AS "hafalanPosition",
              u.name AS "updatedBy", r.updated_at AS "updatedAt",
              (SELECT MAX(l.created_at) FROM lps_links l WHERE l.lps_id = r.id) AS "waSentAt"
       FROM students s JOIN classes c ON c.id = s.class_id JOIN branches b ON b.id = s.branch_id
       LEFT JOIN lps_reports r ON r.student_id = s.id AND r.period = $1 LEFT JOIN users u ON u.id = r.updated_by
       WHERE s.status = 'AKTIF' AND ($2::int[] IS NULL OR s.branch_id = ANY($2))
         AND ($3::text IS NULL OR s.full_name ILIKE $3 OR s.nis ILIKE $3 OR c.name ILIKE $3)
       ORDER BY b.id, c.name, s.full_name`, [period, ids, p.q ? `%${p.q}%` : null]);
    const count = (st: string) => rows.filter((r) => r.status === st).length;
    const filled = rows.filter((r) => r.scores && Object.keys(r.scores).length);
    const aspects = ASPEK.map((a) => {
      const vals = filled.map((r) => r.scores[a]).filter(Boolean);
      const pct = (v: string) => (vals.length ? Math.round((vals.filter((x) => x === v).length / vals.length) * 100) : 0);
      return { aspek: a, sangatBaik: pct('Sangat baik'), baik: pct('Baik'), perluLatihan: pct('Perlu latihan'), n: vals.length };
    });
    const branches = [...new Map(rows.map((r) => [r.branchId, r.branchName])).entries()].map(([id, name]) => {
      const mine = rows.filter((r) => r.branchId === id);
      return { id, name, total: mine.length, terbit: mine.filter((r) => r.status === 'TERBIT').length };
    });
    return { period, label: monthLabel(period), aspekList: ASPEK, nilaiList: NILAI,
      summary: { total: rows.length, BELUM: count('BELUM'), DRAFT: count('DRAFT'), DIPERIKSA: count('DIPERIKSA'), DISETUJUI: count('DISETUJUI'), TERBIT: count('TERBIT') },
      aspects, branches, rows: p.status ? rows.filter((r) => r.status === p.status) : rows };
  }

  private async hafalan(studentId: number) {
    return this.db.one(`SELECT m.percent::float AS percent, s.name || ' ayat ' || m.ayat AS position FROM memorization_records m JOIN surahs s ON s.id = m.surah_id WHERE m.student_id = $1 ORDER BY m.week_start DESC, m.id DESC LIMIT 1`, [studentId]);
  }

  /** Buat draft untuk santri aktif yang belum punya LPS periode ini; hafalan ditarik otomatis. */
  async generate(user: AuthUser, dto: GenDto) {
    const period = dto.period + '-01';
    const students = await this.db.many(
      `SELECT s.id, s.branch_id FROM students s WHERE s.status = 'AKTIF' AND ($1::int[] IS NULL OR s.branch_id = ANY($1)) AND ($2::int IS NULL OR s.class_id = $2)
         AND NOT EXISTS (SELECT 1 FROM lps_reports r WHERE r.student_id = s.id AND r.period = $3)`, [user.branchIds, dto.classId ?? null, period]);
    for (const s of students) {
      const h = await this.hafalan(s.id);
      await this.db.exec(`INSERT INTO lps_reports(student_id, branch_id, period, hafalan_percent, hafalan_position, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$6) ON CONFLICT DO NOTHING`,
        [s.id, s.branch_id, period, h?.percent ?? null, h?.position ?? null, user.id]);
    }
    await this.audit.log(user.id, 'generate', 'lps', null, null, { period: dto.period, count: students.length });
    return { created: students.length };
  }

  private static FULL = `SELECT r.*, s.full_name, s.nis, s.gender, c.name AS class_name, c.level AS class_level, b.name AS branch_name FROM lps_reports r JOIN students s ON s.id = r.student_id JOIN classes c ON c.id = s.class_id JOIN branches b ON b.id = r.branch_id`;
  private async get(user: AuthUser, id: number) {
    const r = await this.db.one(`${LpsService.FULL} WHERE r.id = $1 AND ($2::int[] IS NULL OR r.branch_id = ANY($2))`, [id, user.branchIds]);
    if (!r) throw new NotFoundException('LPS tidak ditemukan');
    return r;
  }

  async update(user: AuthUser, id: number, dto: UpdDto) {
    const r = await this.get(user, id);
    if (r.status !== 'DRAFT') throw new BadRequestException('Hanya LPS berstatus Draft yang bisa diubah');
    if (dto.scores) for (const [k, v] of Object.entries(dto.scores)) if (!ASPEK.includes(k) || !NILAI.includes(v)) throw new BadRequestException(`Nilai tidak valid: ${k}`);
    const h = await this.hafalan(r.student_id);
    await this.db.exec(`UPDATE lps_reports SET scores = $2, note = $3, hafalan_percent = $4, hafalan_position = $5, updated_by = $6, updated_at = now() WHERE id = $1`,
      [id, JSON.stringify({ ...r.scores, ...(dto.scores ?? {}) }), dto.note ?? r.note, h?.percent ?? r.hafalan_percent, h?.position ?? r.hafalan_position, user.id]);
    await this.audit.log(user.id, 'update', 'lps', id, { scores: r.scores, note: r.note }, dto);
    return { ok: true };
  }

  async move(user: AuthUser, id: number, action: string) {
    const [from, to, perm] = FLOW[action] ?? [];
    if (!from) throw new BadRequestException('Aksi tidak dikenal');
    if (!user.perms.includes(perm)) throw new BadRequestException('Anda tidak punya akses untuk langkah ini');
    const r = await this.get(user, id);
    if (r.status !== from) throw new BadRequestException(`LPS harus berstatus ${from}`);
    if (action === 'submit' && ASPEK.some((a) => !r.scores?.[a])) throw new BadRequestException('Lengkapi semua aspek penilaian dulu');
    await this.db.exec(`UPDATE lps_reports SET status = $2, updated_by = $3, updated_at = now(), published_at = CASE WHEN $2 = 'TERBIT' THEN now() ELSE published_at END WHERE id = $1`, [id, to, user.id]);
    await this.audit.log(user.id, action, 'lps', id, { status: from }, { status: to });
    return { ok: true, status: to };
  }

  async revise(user: AuthUser, id: number, note: string) {
    const r = await this.get(user, id);
    if (!['DIPERIKSA', 'DISETUJUI'].includes(r.status)) throw new BadRequestException('Hanya LPS yang sedang diperiksa/disetujui yang bisa dikembalikan');
    await this.db.exec(`UPDATE lps_reports SET status = 'DRAFT', note = COALESCE(note, '') || $2, updated_by = $3, updated_at = now() WHERE id = $1`, [id, `\n[Revisi] ${note}`, user.id]);
    await this.audit.log(user.id, 'revisi', 'lps', id, { status: r.status }, { status: 'DRAFT', note });
    return { ok: true };
  }

  async pdf(user: AuthUser, id: number, res: Response) {
    const r = await this.get(user, id);
    if (r.status !== 'TERBIT' && !user.perms.includes('lps.setujui')) throw new BadRequestException('LPS belum terbit');
    await this.render(r, res);
  }

  // ---------------- Kirim ke WA wali (pola link tagihan /bayar/:token) ----------------
  /** Buat link LPS bertoken (link lama LPS ini dicabut) + pesan dari template Pengaturan + URL wa.me ke no. WA keluarga. Hanya LPS terbit; hanya PJ & ustadzah (no. WA = data sensitif). */
  async waLink(user: AuthUser, id: number) {
    if (!SENSITIVE_ROLES.includes(user.role)) throw new ForbiddenException('Hanya PJ RTA dan ustadzah yang bisa mengirim LPS ke wali');
    const r = await this.get(user, id);
    if (r.status !== 'TERBIT') throw new BadRequestException('Hanya LPS yang sudah terbit yang bisa dikirim ke wali');
    const f = await this.db.one('SELECT f.wa_phone, s.nickname FROM students s JOIN families f ON f.id = s.family_id WHERE s.id = $1', [r.student_id]);
    const phone = String(f?.wa_phone ?? '').replace(/\D/g, '').replace(/^0/, '62');
    if (phone.length < 9) throw new BadRequestException('No. WA wali belum diisi. Lengkapi dulu di menu Wali santri, lalu kirim ulang.');
    const cfg = await this.settings.get();
    const raw = randomBytes(24).toString('base64url');
    await this.db.tx(async (c) => {
      await c.query('UPDATE lps_links SET revoked = true WHERE lps_id = $1 AND revoked = false', [id]);
      await c.query('INSERT INTO lps_links(lps_id, token_hash, expires_at, created_by) VALUES ($1, $2, now() + make_interval(days => $4), $3)', [id, sha(raw), user.id, cfg.linkDays]);
    });
    const base = (process.env.PUBLIC_WEB_URL ?? 'http://localhost:5173').replace(/\/$/, '');
    const url = `${base}/laporan/${raw}`;
    const period = String(r.period).slice(0, 10);
    const message = renderWa(cfg.lpsWaTemplate, { nama: f?.nickname || String(r.full_name).split(' ')[0], periode: monthLabel(period), link: url });
    await this.audit.log(user.id, 'kirim_lps_wa', 'lps', id, null, { period: period.slice(0, 7), linkDays: cfg.linkDays });
    return { url, message, waUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}` };
  }

  // ---------------- Halaman publik wali (tanpa login): data minimum ----------------
  private async byToken(token: string) {
    const l = await this.db.one('SELECT lps_id, expires_at, revoked FROM lps_links WHERE token_hash = $1', [sha(String(token))]);
    if (!l || l.revoked || new Date(l.expires_at) < new Date()) throw new NotFoundException('Link tidak berlaku. Silakan minta link baru ke ustadzah.');
    const r = await this.db.one(`${LpsService.FULL} WHERE r.id = $1 AND r.status = 'TERBIT'`, [l.lps_id]);
    if (!r) throw new NotFoundException('Link tidak berlaku. Silakan minta link baru ke ustadzah.');
    return { r, expiresAt: l.expires_at as string };
  }
  async publicInfo(token: string) {
    const { r, expiresAt } = await this.byToken(token);
    const nick = (await this.db.one('SELECT nickname FROM students WHERE id = $1', [r.student_id]))?.nickname;
    return { who: nick || String(r.full_name).split(' ')[0], periodLabel: monthLabel(String(r.period).slice(0, 10)), branchName: r.branch_name, expiresAt };
  }
  async publicPdf(token: string, res: Response, inline: boolean) {
    const { r } = await this.byToken(token);
    await this.render(r, res, inline);
  }

  // ---------------- Portal wali: hanya LPS terbit milik anak di keluarganya ----------------
  async publishedForFamily(familyId: number) {
    const rows = await this.db.many(
      `SELECT r.id, r.student_id AS "studentId", COALESCE(s.nickname, split_part(s.full_name, ' ', 1)) AS who, r.period,
              r.hafalan_percent::float AS "hafalanPercent", r.published_at AS "publishedAt"
       FROM lps_reports r JOIN students s ON s.id = r.student_id
       WHERE s.family_id = $1 AND r.status = 'TERBIT' ORDER BY r.period DESC, s.full_name`, [familyId]);
    return rows.map((r) => ({ ...r, label: monthLabel(String(r.period)) }));
  }
  async familyPdf(familyId: number, id: number, res: Response) {
    const r = await this.db.one(`${LpsService.FULL} WHERE r.id = $1 AND s.family_id = $2 AND r.status = 'TERBIT'`, [id, familyId]);
    if (!r) throw new NotFoundException('LPS tidak ditemukan');
    await this.render(r, res);
  }

  /** PDF bertema (lps-pdf.ts): identitas, nilai 4 aspek, hafalan, rekap absensi bulan periode LPS, catatan. */
  private async render(r: any, res: Response, inline = false) {
    const period = String(r.period).slice(0, 10);
    const att = await this.db.one<{ H: number; I: number; S: number; A: number }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'H')::int AS "H", COUNT(*) FILTER (WHERE status = 'I')::int AS "I",
              COUNT(*) FILTER (WHERE status = 'S')::int AS "S", COUNT(*) FILTER (WHERE status = 'A')::int AS "A"
       FROM attendance WHERE student_id = $1 AND date >= $2::date AND date < ($2::date + interval '1 month')`, [r.student_id, period]);
    const startM = (await this.settings.get()).academicYearStartMonth;
    const [y, m] = period.split('-').map(Number);
    const y0 = m >= startM ? y : y - 1;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="LPS-${r.nis}-${period.slice(0, 7)}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    renderLpsPdf({
      fullName: r.full_name, nis: r.nis, gender: r.gender, className: r.class_name, level: r.class_level, branchName: r.branch_name,
      period, periodLabel: monthLabel(period), yearLabel: `${y0}/${y0 + 1}`,
      hafalanPercent: r.hafalan_percent == null ? null : Number(r.hafalan_percent), hafalanPosition: r.hafalan_position,
      scores: r.scores ?? {}, note: r.note, hadir: att ?? { H: 0, I: 0, S: 0, A: 0 },
    }, res);
  }
}

@Controller('lps')
export class LpsController {
  constructor(private s: LpsService) {}
  @Get() @Perm('lps.lihat') list(@CurrentUser() u: AuthUser, @Query() q: any) { return this.s.list(u, q); }
  @Post('generate') @Perm('lps.input') gen(@CurrentUser() u: AuthUser, @Body() dto: GenDto) { return this.s.generate(u, dto); }
  // didaftarkan sebelum ':id/:action' agar tidak tertangkap rute alur status
  @Post(':id/wa') @Perm('lps.lihat') wa(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.s.waLink(u, id); }
  @Patch(':id') @Perm('lps.edit') upd(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdDto) { return this.s.update(u, id, dto); }
  @Post(':id/:action') @Perm('lps.lihat') act(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Param('action') a: string, @Body() dto: any) {
    if (a === 'revise') { if (!u.perms.includes('lps.setujui')) throw new BadRequestException('Hanya PJ yang bisa mengembalikan LPS'); return this.s.revise(u, id, String(dto?.note ?? '')); }
    return this.s.move(u, id, a);
  }
  @Get(':id/pdf') @Perm('lps.lihat') pdf(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Res() res: Response) { return this.s.pdf(u, id, res); }
}

/** Publik (wali, tanpa login, dari link WA): dibatasi laju per IP. */
@Controller('public/lps')
export class LpsPublicController {
  constructor(private s: LpsService) {}
  @Public() @Throttle({ default: { limit: 30, ttl: 60_000 } }) @Get(':token') info(@Param('token') t: string) { return this.s.publicInfo(t); }
  @Public() @Throttle({ default: { limit: 20, ttl: 60_000 } }) @Get(':token/pdf') pdf(@Param('token') t: string, @Res() res: Response, @Query('view') v?: string) { return this.s.publicPdf(t, res, v === '1'); }
}

@Module({ controllers: [LpsController, LpsPublicController], providers: [LpsService, AuditService], exports: [LpsService] })
export class LpsModule {}
