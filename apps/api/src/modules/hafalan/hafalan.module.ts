import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';
import { Db } from '../../db/db.module';
import type { AuthUser } from '../../common/auth';
import { CurrentUser, Perm } from '../../common/auth';
import { AuditService } from '../../common/audit.service';
import { addDays, weekStart } from '../../common/time';

class RecordDto {
  @IsInt() studentId: number;
  @IsInt() surahId: number;
  @IsInt() @Min(1) ayat: number;
  @IsOptional() @IsBoolean() confirmLower?: boolean;
}

type Surah = { id: number; level: string; ord: number; name: string; ayat_count: number };

@Injectable()
export class HafalanService {
  private cache: Surah[] | null = null;
  constructor(private db: Db, private audit: AuditService) {}

  async surahs(level?: string) {
    if (!this.cache) this.cache = await this.db.many<Surah>('SELECT id, level, ord, name, ayat_count FROM surahs ORDER BY level, ord');
    return level ? this.cache.filter((s) => s.level === level) : this.cache;
  }
  /** Rumus PRD 7.3: (jumlah ayat surah sebelumnya + ayat posisi terakhir) ÷ total ayat juz × 100 */
  async compute(surahId: number, ayat: number) {
    const all = await this.surahs();
    const s = all.find((x) => x.id === surahId);
    if (!s) throw new BadRequestException('Surah tidak ditemukan');
    if (ayat > s.ayat_count) throw new BadRequestException(`Ayat melebihi jumlah ayat ${s.name} (${s.ayat_count} ayat)`);
    const juz = all.filter((x) => x.level === s.level);
    const before = juz.filter((x) => x.ord < s.ord).reduce((a, x) => a + x.ayat_count, 0);
    const total = juz.reduce((a, x) => a + x.ayat_count, 0);
    const cum = before + ayat;
    return { surah: s, total: cum, juzTotal: total, percent: Math.round((cum / total) * 1000) / 10 };
  }

  private scope(user: AuthUser) { return user.branchIds; }

  /** Kelas dalam scope + rata-rata capaian (santri aktif, posisi terakhir) + progres input pekan ini */
  async classes(user: AuthUser) {
    const ws = weekStart();
    return this.db.many(
      `WITH latest AS (
         SELECT DISTINCT ON (m.student_id) m.student_id, m.percent, m.week_start FROM memorization_records m
         ORDER BY m.student_id, m.week_start DESC, m.id DESC)
       SELECT c.id, c.name, c.level, c.branch_id AS "branchId", b.name AS "branchName",
              COUNT(s.id) FILTER (WHERE s.status = 'AKTIF')::int AS aktif,
              COUNT(s.id) FILTER (WHERE s.status = 'CUTI')::int AS cuti,
              COALESCE(ROUND(AVG(l.percent) FILTER (WHERE s.status = 'AKTIF'), 1), 0)::float AS "avgPercent",
              COUNT(s.id) FILTER (WHERE s.status = 'AKTIF' AND l.week_start = $2)::int AS "doneThisWeek"
       FROM classes c JOIN branches b ON b.id = c.branch_id
       LEFT JOIN students s ON s.class_id = c.id
       LEFT JOIN latest l ON l.student_id = s.id
       WHERE ($1::int[] IS NULL OR c.branch_id = ANY($1))
       GROUP BY c.id, b.id ORDER BY b.id, c.level DESC`, [this.scope(user), ws]);
  }

  /** Daftar santri satu kelas: posisi terakhir, status pekan ini, tren 4 pekan */
  async roster(user: AuthUser, classId: number) {
    const c = await this.db.one('SELECT c.id, c.name, c.level, c.branch_id AS "branchId" FROM classes c WHERE c.id = $1 AND ($2::int[] IS NULL OR c.branch_id = ANY($2))', [classId, this.scope(user)]);
    if (!c) throw new NotFoundException('Kelas tidak ditemukan');
    const students = await this.db.many(
      `SELECT id, nis, full_name AS "fullName", nickname, status FROM students WHERE class_id = $1 AND status IN ('AKTIF','CUTI') ORDER BY full_name`, [classId]);
    const ids = students.map((s) => s.id);
    const recs = ids.length ? await this.db.many(
      `SELECT m.student_id AS "studentId", m.week_start AS "weekStart", m.total_ayat AS total, m.percent::float AS percent, m.ayat, s.name AS surah, m.created_at AS "createdAt"
       FROM memorization_records m JOIN surahs s ON s.id = m.surah_id WHERE m.student_id = ANY($1) ORDER BY m.week_start, m.id`, [ids]) : [];
    const ws = weekStart();
    const weeks = [3, 2, 1, 0].map((k) => addDays(ws, -7 * k));
    const rows = students.map((s) => {
      const mine = recs.filter((r) => r.studentId === s.id);
      const atWeek = (w: string) => { let v: any = null; for (const r of mine) if (r.weekStart <= w) v = r; return v; };
      const last = mine[mine.length - 1] ?? null;
      const trend = weeks.map((w) => atWeek(w)?.total ?? 0);
      const thisWeek = mine.filter((r) => r.weekStart === ws).pop();
      const prev = atWeek(addDays(ws, -7));
      const delta = thisWeek ? thisWeek.total - (prev?.total ?? 0) : null;
      const flat = !!thisWeek && trend[3] === trend[2] && trend[2] === trend[1] && trend[3] > 0;
      const week = s.status === 'CUTI' ? 'CUTI' : !thisWeek ? 'BELUM' : flat ? 'TETAP' : 'SUDAH';
      return { ...s, position: last ? `${last.surah} ayat ${last.ayat}` : null, total: last?.total ?? 0, percent: last?.percent ?? 0, lastAt: last?.createdAt ?? null, week, delta, trend };
    });
    const aktif = rows.filter((r) => r.status === 'AKTIF');
    return {
      class: c, weekStart: ws, juzTotal: (await this.surahs(c.level)).reduce((a, x) => a + x.ayat_count, 0), rows,
      summary: { aktif: aktif.length, done: aktif.filter((r) => r.week !== 'BELUM').length, todo: aktif.filter((r) => r.week === 'BELUM').length,
        flat: aktif.filter((r) => r.week === 'TETAP').length, avgDelta: Math.round(aktif.filter((r) => r.delta != null).reduce((a, r) => a + (r.delta as number), 0) / Math.max(1, aktif.filter((r) => r.delta != null).length)) },
    };
  }

  async history(user: AuthUser, studentId: number) {
    const s = await this.db.one('SELECT id FROM students WHERE id = $1 AND ($2::int[] IS NULL OR branch_id = ANY($2))', [studentId, this.scope(user)]);
    if (!s) throw new NotFoundException('Santri tidak ditemukan');
    return this.db.many(
      `SELECT m.id, m.week_start AS "weekStart", s.name AS surah, m.ayat, m.total_ayat AS total, m.percent::float AS percent, u.name AS "recordedBy", m.created_at AS "createdAt"
       FROM memorization_records m JOIN surahs s ON s.id = m.surah_id JOIN users u ON u.id = m.recorded_by
       WHERE m.student_id = $1 ORDER BY m.week_start DESC, m.id DESC LIMIT 12`, [studentId]);
  }

  async record(user: AuthUser, dto: RecordDto) {
    const st = await this.db.one(
      `SELECT s.id, s.status, s.branch_id AS "branchId", s.class_id AS "classId", c.level FROM students s JOIN classes c ON c.id = s.class_id
       WHERE s.id = $1 AND ($2::int[] IS NULL OR s.branch_id = ANY($2))`, [dto.studentId, this.scope(user)]);
    if (!st) throw new NotFoundException('Santri tidak ditemukan');
    if (st.status !== 'AKTIF') throw new BadRequestException('Hafalan hanya dicatat untuk santri berstatus Aktif');
    const r = await this.compute(dto.surahId, dto.ayat);
    if (r.surah.level !== st.level) throw new BadRequestException('Surah tidak sesuai jenjang santri');
    const prev = await this.db.one('SELECT total_ayat AS total FROM memorization_records WHERE student_id = $1 AND level = $2 ORDER BY week_start DESC, id DESC LIMIT 1', [st.id, st.level]);
    if (prev && r.total < prev.total && !dto.confirmLower)
      throw new ConflictException({ message: `Posisi baru lebih rendah dari sebelumnya (${prev.total} ayat). Konfirmasi bila memang benar.`, code: 'LOWER' });
    const ws = weekStart();
    const row = await this.db.one(
      `INSERT INTO memorization_records(student_id, branch_id, class_id, level, surah_id, ayat, total_ayat, percent, week_start, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [st.id, st.branchId, st.classId, st.level, r.surah.id, dto.ayat, r.total, r.percent, ws, user.id]);
    await this.audit.log(user.id, 'hafalan', 'student', st.id, prev ? { total: prev.total } : null, { surah: r.surah.name, ayat: dto.ayat, total: r.total, percent: r.percent });
    return { id: row!.id, surah: r.surah.name, ayat: dto.ayat, total: r.total, juzTotal: r.juzTotal, percent: r.percent, delta: r.total - (prev?.total ?? 0) };
  }

  /** Ringkasan untuk dashboard */
  async dashboard(branchIds: number[] | null) {
    return this.db.many(
      `WITH latest AS (SELECT DISTINCT ON (student_id) student_id, percent FROM memorization_records ORDER BY student_id, week_start DESC, id DESC)
       SELECT c.id AS "classId", c.name AS "className", COALESCE(ROUND(AVG(l.percent), 1), 0)::float AS avg
       FROM classes c LEFT JOIN students s ON s.class_id = c.id AND s.status = 'AKTIF' LEFT JOIN latest l ON l.student_id = s.id
       WHERE ($1::int[] IS NULL OR c.branch_id = ANY($1)) GROUP BY c.id ORDER BY c.branch_id, c.level DESC`, [branchIds]);
  }
  async topProgress(branchIds: number[] | null, limit = 4) {
    return this.db.many(
      `WITH latest AS (SELECT DISTINCT ON (student_id) student_id, percent, total_ayat FROM memorization_records ORDER BY student_id, week_start DESC, id DESC)
       SELECT s.id, s.full_name AS "fullName", c.name AS "className", l.percent::float AS percent
       FROM latest l JOIN students s ON s.id = l.student_id JOIN classes c ON c.id = s.class_id
       WHERE s.status = 'AKTIF' AND ($1::int[] IS NULL OR s.branch_id = ANY($1)) ORDER BY l.percent DESC LIMIT $2`, [branchIds, limit]);
  }
}

@Controller('hafalan')
export class HafalanController {
  constructor(private s: HafalanService) {}
  @Get('surahs') @Perm('kelas.lihat') surahs(@Query('level') level?: string) { return this.s.surahs(level); }
  @Get('classes') @Perm('kelas.lihat') classes(@CurrentUser() u: AuthUser) { return this.s.classes(u); }
  @Get('classes/:id') @Perm('kelas.lihat') roster(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.s.roster(u, id); }
  @Get('students/:id') @Perm('kelas.lihat') history(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.s.history(u, id); }
  @Post('records') @Perm('kelas.input') record(@CurrentUser() u: AuthUser, @Body() dto: RecordDto) { return this.s.record(u, dto); }
}

@Module({ controllers: [HafalanController], providers: [HafalanService, AuditService], exports: [HafalanService] })
export class HafalanModule {}
