import { Controller, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Db } from '../../db/db.module';
import type { AuthUser } from '../../common/auth';
import { CurrentUser, Perm } from '../../common/auth';
import { BillingModule, BillingService } from '../billing/billing.module';
import { LpsModule, LpsService, ASPEK } from '../lps/lps.module';
import { HafalanModule, HafalanService } from '../hafalan/hafalan.module';
import { SettingsService } from '../settings/settings.module';
import { academicYearStart, monthLabel } from '../../common/time';

const MAX_PROOF = 5 * 1024 * 1024;

/**
 * Portal akun wali ("Anak Saya"): tagihan + unggah bukti, dan LPS terbit milik anak di keluarganya.
 * Scope = users.family_id (dibaca ulang dari DB tiap request, bukan dari token). Data minimum: tanpa kontak, alamat, kesehatan, label subsidi.
 */
@Injectable()
export class PortalService {
  constructor(private db: Db, private billing: BillingService, private lps: LpsService, private hafalan: HafalanService, private settings: SettingsService) {}

  private async familyId(user: AuthUser) {
    const u = await this.db.one('SELECT family_id FROM users WHERE id = $1 AND is_active', [user.id]);
    if (!u?.family_id) throw new NotFoundException('Akun ini belum terhubung ke data keluarga. Silakan hubungi PJ RTA.');
    return u.family_id as number;
  }

  async home(user: AuthUser) {
    const familyId = await this.familyId(user);
    const kids = await this.db.many(
      `SELECT s.id, s.full_name AS "fullName", COALESCE(s.nickname, split_part(s.full_name, ' ', 1)) AS nickname, s.status,
              c.name AS "className", b.name AS "branchName"
       FROM students s JOIN classes c ON c.id = s.class_id JOIN branches b ON b.id = s.branch_id
       WHERE s.family_id = $1 AND s.archived_at IS NULL ORDER BY s.birth_date`, [familyId]);
    return { kids, tagihan: await this.billing.familyBills(familyId), lps: await this.lps.publishedForFamily(familyId) };
  }

  /**
   * Menu "Perkembangan": progres hafalan tiap anak selama tahun pembelajaran berjalan (posisi terakhir per pekan),
   * peta surah juz yang sedang dihafal, dan nilai aspek LPS yang sudah TERBIT. Tanpa catatan internal, kontak, maupun subsidi.
   */
  async progress(user: AuthUser) {
    const familyId = await this.familyId(user);
    const cfg = await this.settings.get();
    const start = academicYearStart(cfg.academicYearStartMonth);
    const y = Number(start.slice(0, 4));
    const kids = await this.db.many(
      `SELECT s.id, s.full_name AS "fullName", COALESCE(s.nickname, split_part(s.full_name, ' ', 1)) AS nickname, s.status,
              c.name AS "className", c.level AS "classLevel"
       FROM students s JOIN classes c ON c.id = s.class_id
       WHERE s.family_id = $1 AND s.archived_at IS NULL ORDER BY s.birth_date`, [familyId]);
    const ids = kids.map((k) => k.id);
    // Posisi terakhir per pekan sepanjang tahun pembelajaran + satu catatan terakhir sebelum tahun dimulai (titik awal).
    const weeks = await this.db.many(
      `SELECT DISTINCT ON (m.student_id, m.week_start) m.student_id AS "studentId", m.week_start::text AS "weekStart", m.level,
              s.name AS surah, m.ayat, m.percent::float AS percent
       FROM memorization_records m JOIN surahs s ON s.id = m.surah_id
       WHERE m.student_id = ANY($1) AND m.week_start >= $2::date
       ORDER BY m.student_id, m.week_start, m.id DESC`, [ids, start]);
    const before = await this.db.many(
      `SELECT DISTINCT ON (m.student_id) m.student_id AS "studentId", m.level, m.percent::float AS percent
       FROM memorization_records m WHERE m.student_id = ANY($1) AND m.week_start < $2::date
       ORDER BY m.student_id, m.week_start DESC, m.id DESC`, [ids, start]);
    const lps = await this.db.many(
      `SELECT r.student_id AS "studentId", r.period::text AS period, r.scores, r.hafalan_percent::float AS "hafalanPercent"
       FROM lps_reports r WHERE r.student_id = ANY($1) AND r.status = 'TERBIT' AND r.period >= $2::date ORDER BY r.period`, [ids, start]);
    const surahs = await this.hafalan.surahs();

    return {
      yearStart: start, yearLabel: `${y}/${y + 1}`,
      kids: kids.map((k) => {
        const w = weeks.filter((x) => x.studentId === k.id).map(({ studentId, ...x }) => x);
        const last = w[w.length - 1] ?? null;
        const level = last?.level ?? k.classLevel;
        const prev = before.find((x) => x.studentId === k.id);
        const sameLevel = w.filter((x) => x.level === level);
        // Titik awal: posisi sebelum tahun dimulai (bila juz sama), selain itu catatan pertama di juz ini tahun ini.
        const startPercent = prev && prev.level === level ? prev.percent : sameLevel[0]?.percent ?? null;
        const juz = surahs.filter((s) => s.level === level);
        const cur = last && last.level === level ? juz.find((s) => s.name === last.surah) : undefined;
        return {
          id: k.id, fullName: k.fullName, nickname: k.nickname, status: k.status, className: k.className, level,
          current: last ? { percent: last.percent, surah: last.surah, ayat: last.ayat, weekStart: last.weekStart } : null,
          startPercent,
          weeks: w,
          surahs: juz.map((s) => ({
            name: s.name, ayatCount: s.ayat_count,
            state: !cur ? 'BELUM' : s.ord < cur.ord ? 'SELESAI' : s.ord === cur.ord ? (last!.ayat >= s.ayat_count ? 'SELESAI' : 'BERJALAN') : 'BELUM',
            ayat: !cur ? 0 : s.ord < cur.ord ? s.ayat_count : s.ord === cur.ord ? last!.ayat : 0,
          })),
          lps: lps.filter((r) => r.studentId === k.id).map((r) => ({
            period: r.period, label: monthLabel(r.period), hafalanPercent: r.hafalanPercent,
            scores: Object.fromEntries(ASPEK.map((a) => [a, r.scores?.[a] ?? null])),
          })),
        };
      }),
    };
  }

  async upload(user: AuthUser, file?: Express.Multer.File) { return this.billing.familyUpload(await this.familyId(user), user.id, file); }
  async lpsPdf(user: AuthUser, id: number, res: Response) { return this.lps.familyPdf(await this.familyId(user), id, res); }
}

@Controller('portal')
export class PortalController {
  constructor(private s: PortalService) {}
  @Get() @Perm('portal.lihat') home(@CurrentUser() u: AuthUser) { return this.s.home(u); }
  @Get('perkembangan') @Perm('portal.lihat') progress(@CurrentUser() u: AuthUser) { return this.s.progress(u); }
  @Post('bukti') @Perm('portal.input') @Throttle({ default: { limit: 5, ttl: 60_000 } }) @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PROOF } }))
  upload(@CurrentUser() u: AuthUser, @UploadedFile() file?: Express.Multer.File) { return this.s.upload(u, file); }
  @Get('lps/:id/pdf') @Perm('portal.lihat') pdf(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Res() res: Response) { return this.s.lpsPdf(u, id, res); }
}

@Module({ imports: [BillingModule, LpsModule, HafalanModule], controllers: [PortalController], providers: [PortalService] })
export class PortalModule {}
