import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Db } from '../../db/db.module';
import { CurrentUser, Perm } from '../../common/auth';
import type { AuthUser } from '../../common/auth';
import { AuditService } from '../../common/audit.service';
import { canSeeSensitive } from '../../common/mask';
import { addDays, addMonths, monthLabel, todayWIB } from '../../common/time';
import { printedBy, sendPdf, sendXlsx } from '../../common/report';
import type { Sheet } from '../../common/report';
import { SettingsService, renderWa } from '../settings/settings.module';

export const ATT_STATUS = ['H', 'I', 'S', 'A'] as const;
type St = (typeof ATT_STATUS)[number];
/** Isi sel rekap: status tercatat, BELUM (hari belajar lewat tapi belum diisi), CUTI (santri sedang cuti, tidak diabsen), null (tidak berlaku). */
type Cell = St | 'BELUM' | 'CUTI' | null;
type DayKind = 'BELAJAR' | 'LIBUR' | 'NANTI';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-\d{2}$/;
const HARI = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Ahd'];
const NAMA: Record<string, string> = { H: 'Hadir', I: 'Izin', S: 'Sakit', A: 'Alpa', BELUM: 'Belum diisi', CUTI: 'Cuti' };
/** 1 = Senin … 7 = Ahad (ISO) dari 'YYYY-MM-DD' */
const isoDow = (ymd: string) => { const d = new Date(ymd + 'T00:00:00Z').getUTCDay(); return d === 0 ? 7 : d; };
const validDate = (ymd: string) => YMD.test(ymd) && !Number.isNaN(Date.parse(ymd + 'T00:00:00Z')) && new Date(ymd + 'T00:00:00Z').toISOString().slice(0, 10) === ymd;
const tglPendek = (ymd: string) => `${Number(ymd.slice(8, 10))} ${['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][Number(ymd.slice(5, 7)) - 1]}`;

class EntryDto {
  @IsInt() studentId: number;
  @IsIn(ATT_STATUS as unknown as string[], { message: 'Status absensi harus H, I, S, atau A' }) status: St;
  @IsOptional() @IsString() @MaxLength(200, { message: 'Keterangan maksimal 200 karakter' }) note?: string;
}
class SaveDayDto {
  @IsInt() classId: number;
  @Matches(YMD, { message: 'Format tanggal harus YYYY-MM-DD' }) date: string;
  @IsArray() @ArrayMinSize(1, { message: 'Belum ada santri yang diabsen' }) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => EntryDto) entries: EntryDto[];
}

type Member = { id: number; nis: string; fullName: string; nickname: string | null; status: string; joinDate: string | null; classId: number; familyId: number };

@Injectable()
export class AbsensiService {
  constructor(private db: Db, private audit: AuditService, private settings: SettingsService) {}

  /** Kelas dalam scope (404 bila di luar scope agar keberadaannya tidak bocor). */
  private async klass(user: AuthUser, classId: number) {
    const c = await this.db.one(
      `SELECT c.id, c.name, c.level, c.branch_id AS "branchId", b.name AS "branchName" FROM classes c JOIN branches b ON b.id = c.branch_id
       WHERE c.id = $1 AND ($2::int[] IS NULL OR c.branch_id = ANY($2))`, [classId, user.branchIds]);
    if (!c) throw new NotFoundException('Kelas tidak ditemukan');
    return c;
  }

  /** Hari libur dari Agenda (kategori LIBUR, tidak dibatalkan) untuk satu cabang dalam rentang tanggal: 'YYYY-MM-DD' → judul. */
  private async holidays(branchId: number, from: string, to: string) {
    const rows = await this.db.many(
      `SELECT title, GREATEST(start_date, $2::date)::text AS s, LEAST(end_date, $3::date)::text AS e FROM agendas
       WHERE category = 'LIBUR' AND cancelled_at IS NULL AND (branch_id IS NULL OR branch_id = $1) AND start_date <= $3 AND end_date >= $2`, [branchId, from, to]);
    const out = new Map<string, string>();
    for (const r of rows) for (let d = r.s; d <= r.e; d = addDays(d, 1)) if (!out.has(d)) out.set(d, r.title);
    return out;
  }

  private dayKind(date: string, days: number[], hol: Map<string, string>, today: string): { kind: DayKind; holiday: string | null } {
    if (!days.includes(isoDow(date))) return { kind: 'LIBUR', holiday: null };
    if (hol.has(date)) return { kind: 'LIBUR', holiday: hol.get(date)! };
    return { kind: date > today ? 'NANTI' : 'BELAJAR', holiday: null };
  }

  /** Anggota kelas saat ini (Aktif & Cuti) yang sudah masuk sebelum/pada tanggal `until`. join_date NULL = santri lama (impor), selalu ikut. */
  private members(classId: number, until: string) {
    return this.db.many<Member>(
      `SELECT id, nis, full_name AS "fullName", nickname, status, join_date::text AS "joinDate", class_id AS "classId", family_id AS "familyId"
       FROM students WHERE class_id = $1 AND status IN ('AKTIF', 'CUTI') AND (join_date IS NULL OR join_date <= $2) ORDER BY full_name`, [classId, until]);
  }

  // ---------------- Daftar kelas + progres hari ini ----------------
  async classes(user: AuthUser) {
    const today = todayWIB();
    const cfg = await this.settings.get();
    const rows = await this.db.many(
      `SELECT c.id, c.name, c.level, c.branch_id AS "branchId", b.name AS "branchName",
              COUNT(s.id) FILTER (WHERE s.status = 'AKTIF' AND (s.join_date IS NULL OR s.join_date <= $2))::int AS aktif,
              COUNT(s.id) FILTER (WHERE s.status = 'CUTI')::int AS cuti,
              COUNT(a.id) FILTER (WHERE s.status = 'AKTIF')::int AS "doneToday"
       FROM classes c JOIN branches b ON b.id = c.branch_id
       LEFT JOIN students s ON s.class_id = c.id
       LEFT JOIN attendance a ON a.student_id = s.id AND a.date = $2
       WHERE ($1::int[] IS NULL OR c.branch_id = ANY($1)) AND b.is_active
       GROUP BY c.id, b.id ORDER BY b.id, c.level DESC`, [user.branchIds, today]);
    const holByBranch = new Map<number, Map<string, string>>();
    for (const r of rows) if (!holByBranch.has(r.branchId)) holByBranch.set(r.branchId, await this.holidays(r.branchId, today, today));
    return rows.map((r) => {
      const k = this.dayKind(today, cfg.attendanceDays, holByBranch.get(r.branchId)!, today);
      return { ...r, today, schoolDay: k.kind === 'BELAJAR', holiday: k.holiday };
    });
  }

  /** Jumlah kelas yang punya santri aktif dan absensi hari ini belum lengkap (untuk Beranda). */
  async todo(branchIds: number[] | null) {
    const list = await this.classes({ branchIds } as AuthUser);
    return list.filter((c) => c.schoolDay && c.aktif > 0 && c.doneToday < c.aktif).map((c) => ({ classId: c.id, name: c.name, branchName: c.branchName, todo: c.aktif - c.doneToday }));
  }

  // ---------------- Absensi satu hari ----------------
  async day(user: AuthUser, classId: number, date?: string) {
    const c = await this.klass(user, classId);
    const today = todayWIB();
    const d = date ?? today;
    if (!validDate(d)) throw new BadRequestException('Tanggal tidak valid');
    const cfg = await this.settings.get();
    const k = this.dayKind(d, cfg.attendanceDays, await this.holidays(c.branchId, d, d), today);
    const mem = await this.members(classId, d);
    const rec = await this.db.many(
      `SELECT a.student_id AS "studentId", a.status, a.note, a.class_id AS "classId", COALESCE(uu.name, u.name) AS "recordedBy", COALESCE(a.updated_at, a.created_at) AS "recordedAt"
       FROM attendance a JOIN users u ON u.id = a.recorded_by LEFT JOIN users uu ON uu.id = a.updated_by
       WHERE a.date = $1 AND (a.class_id = $2 OR a.student_id = ANY($3))`, [d, classId, mem.map((m) => m.id)]);
    const byId = new Map(rec.map((r) => [r.studentId, r]));
    const sens = canSeeSensitive(user);
    const rows = mem.map((m) => {
      const r = byId.get(m.id);
      return { id: m.id, nis: m.nis, fullName: m.fullName, nickname: m.nickname, status: m.status, attendance: r?.status ?? null, note: r?.note ? (sens ? r.note : 'Disembunyikan') : null };
    });
    // santri yang tercatat di kelas ini pada tanggal itu tapi sudah pindah/keluar: tampil hanya baca
    const gone = rec.filter((r) => r.classId === classId && !mem.some((m) => m.id === r.studentId));
    const goneRows = gone.length ? (await this.db.many('SELECT id, nis, full_name AS "fullName", nickname, status FROM students WHERE id = ANY($1)', [gone.map((g) => g.studentId)]))
      .map((s) => { const r = byId.get(s.id); return { ...s, status: 'PINDAH', attendance: r.status, note: r.note ? (sens ? r.note : 'Disembunyikan') : null }; }) : [];
    const last = rec.filter((r) => r.classId === classId).sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)))[0];
    const aktif = rows.filter((r) => r.status === 'AKTIF');
    const count = (s: St) => [...rows, ...goneRows].filter((r) => r.attendance === s).length;
    return {
      class: c, date: d, today, kind: k.kind, holiday: k.holiday,
      editable: k.kind === 'BELAJAR' && user.perms.includes('absensi.input'),
      rows: [...rows, ...goneRows],
      summary: { aktif: aktif.length, filled: aktif.filter((r) => r.attendance).length, H: count('H'), I: count('I'), S: count('S'), A: count('A'), cuti: rows.filter((r) => r.status === 'CUTI').length },
      lastSaved: last ? { by: last.recordedBy, at: last.recordedAt } : null,
    };
  }

  async saveDay(user: AuthUser, dto: SaveDayDto) {
    const c = await this.klass(user, dto.classId);
    const today = todayWIB();
    if (!validDate(dto.date)) throw new BadRequestException('Tanggal tidak valid');
    if (dto.date > today) throw new BadRequestException('Absensi untuk tanggal yang belum lewat belum bisa diisi');
    const cfg = await this.settings.get();
    const k = this.dayKind(dto.date, cfg.attendanceDays, await this.holidays(c.branchId, dto.date, dto.date), today);
    if (k.kind !== 'BELAJAR') throw new BadRequestException(k.holiday ? `Tanggal ini libur: ${k.holiday}` : 'Tanggal ini bukan hari belajar');
    const ids = dto.entries.map((e) => e.studentId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Ada santri yang tercantum dua kali');
    const mem = await this.members(dto.classId, dto.date);
    for (const e of dto.entries) {
      const m = mem.find((x) => x.id === e.studentId);
      if (!m) throw new BadRequestException('Ada santri yang bukan anggota kelas ini pada tanggal tersebut. Muat ulang halaman.');
      if (m.status !== 'AKTIF') throw new BadRequestException(`${m.fullName} sedang cuti, tidak perlu diabsen`);
    }
    const clean = dto.entries.map((e) => ({ studentId: e.studentId, status: e.status, note: e.status === 'I' || e.status === 'S' ? (e.note?.trim() || null) : null }));
    const changes = await this.db.tx(async (cl) => {
      const old = (await cl.query('SELECT student_id, status, note FROM attendance WHERE date = $1 AND student_id = ANY($2) FOR UPDATE', [dto.date, ids])).rows;
      const before = new Map(old.map((o: any) => [o.student_id, o]));
      const changed: { studentId: number; from: any; to: any }[] = [];
      for (const e of clean) {
        const o: any = before.get(e.studentId);
        if (o && o.status === e.status && (o.note ?? null) === e.note) continue;
        await cl.query(
          `INSERT INTO attendance(student_id, branch_id, class_id, date, status, note, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (student_id, date) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, branch_id = EXCLUDED.branch_id,
             class_id = EXCLUDED.class_id, updated_by = $7, updated_at = now()`,
          [e.studentId, c.branchId, c.id, dto.date, e.status, e.note, user.id]);
        changed.push({ studentId: e.studentId, from: o ? { status: o.status, note: o.note } : null, to: { status: e.status, note: e.note } });
      }
      return changed;
    });
    if (changes.length)
      await this.audit.log(user.id, 'absensi', 'class', c.id,
        { date: dto.date, entries: changes.filter((x) => x.from).map((x) => ({ studentId: x.studentId, ...x.from })) },
        { date: dto.date, entries: changes.map((x) => ({ studentId: x.studentId, ...x.to })) });
    const n = (s: St) => clean.filter((e) => e.status === s).length;
    return { ok: true, changed: changes.length, summary: { H: n('H'), I: n('I'), S: n('S'), A: n('A') } };
  }

  // ---------------- Rekap bulanan ----------------
  private monthRange(month?: string) {
    const ym = month ?? todayWIB().slice(0, 7);
    if (!YM.test(ym) || Number(ym.slice(5, 7)) < 1 || Number(ym.slice(5, 7)) > 12) throw new BadRequestException('Format bulan harus YYYY-MM');
    const from = `${ym}-01`, to = addDays(addMonths(from, 1), -1);
    return { ym, from, to };
  }

  /** Hitung baris rekap satu santri dari sel-selnya: jumlah, %, alpa berturut-turut terpanjang, tanda perlu perhatian. */
  private stats(cells: { date: string; v: Cell }[], cfg: { attendanceAlpaStreak: number; attendanceMinPercent: number }) {
    const n = { H: 0, I: 0, S: 0, A: 0, BELUM: 0 };
    let run = 0, runStart = '', best = 0, bestFrom = '', bestTo = '';
    for (const c of cells) {
      if (c.v && c.v in n) (n as any)[c.v]++;
      if (c.v === 'A') { if (!run) runStart = c.date; run++; if (run >= best) { best = run; bestFrom = runStart; bestTo = c.date; } }
      else if (c.v === 'H' || c.v === 'I' || c.v === 'S') run = 0; // hari belum diisi / libur tidak memutus hitungan
    }
    const meet = n.H + n.I + n.S + n.A;
    const percent = meet ? Math.round((n.H / meet) * 100) : null;
    const reasons: string[] = [];
    if (best >= cfg.attendanceAlpaStreak) reasons.push(`Alpa ${best}× berturut-turut`);
    if (percent != null && percent < cfg.attendanceMinPercent) reasons.push(`Kehadiran di bawah ${cfg.attendanceMinPercent}%`);
    return { counts: n, meetings: meet, percent, alpaStreak: best >= 2 ? { n: best, from: bestFrom, to: bestTo } : null, attention: reasons };
  }

  async recap(user: AuthUser, classId: number, month?: string) {
    const c = await this.klass(user, classId);
    const { ym, from, to } = this.monthRange(month);
    const today = todayWIB();
    const cfg = await this.settings.get();
    const hol = await this.holidays(c.branchId, from, to);
    const days: { date: string; day: number; dow: string; kind: DayKind; holiday: string | null }[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) { const k = this.dayKind(d, cfg.attendanceDays, hol, today); days.push({ date: d, day: Number(d.slice(8)), dow: HARI[isoDow(d) - 1], ...k }); }
    const mem = await this.members(classId, to);
    const rec = await this.db.many(
      `SELECT a.student_id AS "studentId", a.date::text AS date, a.status, a.class_id AS "classId" FROM attendance a
       WHERE a.date BETWEEN $1 AND $2 AND (a.class_id = $3 OR a.student_id = ANY($4))`, [from, to, classId, mem.map((m) => m.id)]);
    const goneIds = [...new Set(rec.filter((r) => r.classId === classId && !mem.some((m) => m.id === r.studentId)).map((r) => r.studentId))];
    const gone = goneIds.length ? await this.db.many('SELECT id, nis, full_name AS "fullName", nickname, status, join_date::text AS "joinDate" FROM students WHERE id = ANY($1)', [goneIds]) : [];
    const key = (sid: number, d: string) => `${sid}|${d}`;
    const map = new Map(rec.map((r) => [key(r.studentId, r.date), r]));
    const build = (s: any, moved: boolean) => {
      const cells = days.map((d) => {
        const r = map.get(key(s.id, d.date));
        // catatan di kelas lain (mis. sebelum pindah kelas) tidak ditampilkan di kelas ini
        let v: Cell = r && r.classId === classId ? r.status : null;
        if (!v && !r && d.kind === 'BELAJAR' && !moved && (!s.joinDate || d.date >= s.joinDate)) v = s.status === 'CUTI' ? 'CUTI' : 'BELUM';
        return { date: d.date, v };
      });
      const st = this.stats(cells, cfg);
      return { id: s.id, nis: s.nis, fullName: s.fullName, nickname: s.nickname, status: moved ? 'PINDAH' : s.status, cells: cells.map((x) => x.v), ...st };
    };
    const rows = [...mem.map((m) => build(m, false)), ...gone.map((g) => build(g, true))]
      .sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101) || a.fullName.localeCompare(b.fullName));
    const sum = rows.reduce((acc, r) => { for (const k of ['H', 'I', 'S', 'A', 'BELUM'] as const) acc[k] += r.counts[k]; return acc; }, { H: 0, I: 0, S: 0, A: 0, BELUM: 0 });
    const meet = sum.H + sum.I + sum.S + sum.A;
    const passed = days.filter((d) => d.kind === 'BELAJAR');
    return {
      class: c, month: ym, label: monthLabel(from), today, days,
      meetings: passed.length,
      rules: { days: cfg.attendanceDays, alpaStreak: cfg.attendanceAlpaStreak, minPercent: cfg.attendanceMinPercent },
      rows,
      summary: { percent: meet ? Math.round((sum.H / meet) * 100) : null, ...sum, attention: rows.filter((r) => r.attention.length && r.status !== 'PINDAH').length },
    };
  }

  /** Rata-rata kehadiran per kelas dalam scope untuk satu bulan (kartu "Per kelas"). */
  async perClass(user: AuthUser, month?: string, branchId?: number) {
    const { from, to } = this.monthRange(month);
    const ids = branchId ? (user.branchIds ? user.branchIds.filter((b) => b === branchId) : [branchId]) : user.branchIds;
    return this.db.many(
      `SELECT c.id AS "classId", c.name, b.name AS "branchName",
              COUNT(a.id) FILTER (WHERE a.status = 'H')::int AS hadir, COUNT(a.id)::int AS total,
              CASE WHEN COUNT(a.id) > 0 THEN ROUND(100.0 * COUNT(a.id) FILTER (WHERE a.status = 'H') / COUNT(a.id))::int END AS percent
       FROM classes c JOIN branches b ON b.id = c.branch_id
       LEFT JOIN attendance a ON a.class_id = c.id AND a.date BETWEEN $2 AND $3
       WHERE ($1::int[] IS NULL OR c.branch_id = ANY($1)) AND b.is_active
       GROUP BY c.id, b.id ORDER BY b.id, c.level DESC`, [ids, from, to]);
  }

  // ---------------- Detail satu santri ----------------
  async student(user: AuthUser, studentId: number, month?: string) {
    const s = await this.db.one(
      `SELECT s.id, s.nis, s.full_name AS "fullName", s.nickname, s.status, s.join_date::text AS "joinDate", s.class_id AS "classId", s.branch_id AS "branchId",
              c.name AS "className", b.name AS "branchName", f.wa_phone AS "waPhone"
       FROM students s JOIN classes c ON c.id = s.class_id JOIN branches b ON b.id = s.branch_id JOIN families f ON f.id = s.family_id
       WHERE s.id = $1 AND ($2::int[] IS NULL OR s.branch_id = ANY($2))`, [studentId, user.branchIds]);
    if (!s) throw new NotFoundException('Santri tidak ditemukan');
    const { ym, from, to } = this.monthRange(month);
    const today = todayWIB();
    const cfg = await this.settings.get();
    const hol = await this.holidays(s.branchId, from, to);
    const rec = await this.db.many(
      `SELECT a.date::text AS date, a.status, a.note, c.name AS "className" FROM attendance a JOIN classes c ON c.id = a.class_id
       WHERE a.student_id = $1 AND a.date BETWEEN $2 AND $3 AND ($4::int[] IS NULL OR a.branch_id = ANY($4))`, [studentId, from, to, user.branchIds]);
    const byDate = new Map(rec.map((r) => [r.date, r]));
    const sens = canSeeSensitive(user);
    const days: any[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const k = this.dayKind(d, cfg.attendanceDays, hol, today);
      const r = byDate.get(d);
      let v: Cell = r?.status ?? null;
      if (!v && k.kind === 'BELAJAR' && (!s.joinDate || d >= s.joinDate)) v = s.status === 'CUTI' ? 'CUTI' : s.status === 'AKTIF' ? 'BELUM' : null;
      days.push({ date: d, day: Number(d.slice(8)), dow: isoDow(d), ...k, v, note: r?.note ? (sens ? r.note : 'Disembunyikan') : null });
    }
    const st = this.stats(days.map((d) => ({ date: d.date, v: d.v })), cfg);
    // pesan WA wali: hanya untuk role yang boleh melihat no. WA dan bisa mengisi absensi; isi pesan tanpa data sensitif
    let wa: { message: string; waUrl: string } | null = null;
    const alpa = days.filter((d) => d.v === 'A').map((d) => d.date);
    if (sens && user.perms.includes('absensi.input') && alpa.length && s.waPhone) {
      const recent = alpa.slice(-5);
      const tanggal = recent.map(tglPendek).join(', ').replace(/, ([^,]*)$/, ' & $1');
      const base = (process.env.PUBLIC_WEB_URL ?? 'http://localhost:5173').replace(/\/$/, '');
      const message = renderWa(cfg.attendanceWaTemplate, { nama: s.nickname || s.fullName.split(' ')[0], tanggal, link: `${base}/perkembangan` });
      wa = { message, waUrl: `https://wa.me/${String(s.waPhone).replace(/\D/g, '').replace(/^0/, '62')}?text=${encodeURIComponent(message)}` };
    }
    return {
      student: { id: s.id, nis: s.nis, fullName: s.fullName, nickname: s.nickname, status: s.status, classId: s.classId, className: s.className, branchName: s.branchName },
      month: ym, label: monthLabel(from), today, days, ...st, wa,
    };
  }

  /** Dicatat saat tombol "Kabari wali" dipakai (tanpa isi pesan / nomor). */
  async logWa(user: AuthUser, studentId: number) {
    const s = await this.db.one('SELECT id FROM students WHERE id = $1 AND ($2::int[] IS NULL OR branch_id = ANY($2))', [studentId, user.branchIds]);
    if (!s) throw new NotFoundException('Santri tidak ditemukan');
    await this.audit.log(user.id, 'kabari_wali_absensi', 'student', studentId);
    return { ok: true };
  }

  // ---------------- Ekspor ----------------
  async exportReport(user: AuthUser, res: Response, fmt: 'xlsx' | 'pdf', classId: number, month?: string) {
    const r = await this.recap(user, classId, month);
    await this.db.exec('INSERT INTO export_logs(user_id, report, filters) VALUES ($1,$2,$3)', [user.id, `absensi_${fmt}`, JSON.stringify({ month: r.month, classId })]);
    const sym = (v: Cell) => (v === 'BELUM' ? '?' : v === 'CUTI' ? 'C' : v ?? '');
    const study = r.days.map((d, i) => ({ d, i })).filter((x) => x.d.kind !== 'LIBUR');
    const meta = {
      title: `Rekap Absensi — ${r.class.branchName} ${r.class.name} · ${r.label}`,
      subtitle: `Rumah Tahfidz Al-Fatihah · ${r.meetings} pertemuan s.d. ${tglPendek(r.today > r.days[r.days.length - 1].date ? r.days[r.days.length - 1].date : r.today)} · ${printedBy(user.name)}`,
      summary: [['Rata-rata kehadiran', r.summary.percent == null ? '-' : `${r.summary.percent}%`], ['Izin', String(r.summary.I)], ['Sakit', String(r.summary.S)], ['Alpa', String(r.summary.A)],
        ['Perlu perhatian', `${r.summary.attention} santri`]] as [string, string][],
    };
    const sheets: Sheet[] = [
      { name: 'Ringkasan', columns: [
          { header: 'ID santri', key: 'nis', width: 13 }, { header: 'Nama', key: 'fullName', width: 26 }, { header: 'Hadir', key: 'H', width: 7, align: 'right' }, { header: 'Izin', key: 'I', width: 7, align: 'right' },
          { header: 'Sakit', key: 'S', width: 7, align: 'right' }, { header: 'Alpa', key: 'A', width: 7, align: 'right' }, { header: 'Belum diisi', key: 'BELUM', width: 10, align: 'right' },
          { header: 'Kehadiran', key: 'pct', width: 10, align: 'right' }, { header: 'Catatan', key: 'note', width: 34 }],
        rows: r.rows.map((x) => ({ nis: x.nis, fullName: x.fullName, ...x.counts, pct: x.percent == null ? '-' : `${x.percent}%`,
          note: [x.status === 'CUTI' ? 'Cuti' : x.status === 'PINDAH' ? 'Sudah pindah' : '', ...x.attention].filter(Boolean).join(' · ') })) },
      { name: 'Harian', columns: [{ header: 'Nama', key: 'fullName', width: 22 }, ...study.map(({ d }) => ({ header: `${d.dow} ${d.day}`, key: `d${d.day}`, width: 5 }))],
        rows: r.rows.map((x) => ({ fullName: x.fullName, ...Object.fromEntries(study.map(({ d, i }) => [`d${d.day}`, sym(x.cells[i])])) })) },
    ];
    const file = `absensi-${r.class.branchName}-${r.class.level}-${r.month}`;
    if (fmt === 'xlsx') return sendXlsx(res, file, meta, sheets);
    sendPdf(res, file, meta, sheets, { landscape: true, footnote: 'H = hadir, I = izin, S = sakit, A = alpa, C = cuti, ? = belum diisi. Kehadiran = hadir ÷ pertemuan yang sudah diisi; hari libur, masa cuti, dan tanggal yang belum diisi tidak dihitung.' });
  }
}

@Controller('absensi')
export class AbsensiController {
  constructor(private s: AbsensiService) {}
  @Get('classes') @Perm('absensi.lihat') classes(@CurrentUser() u: AuthUser) { return this.s.classes(u); }
  @Get('day') @Perm('absensi.lihat') day(@CurrentUser() u: AuthUser, @Query('classId', ParseIntPipe) classId: number, @Query('date') date?: string) { return this.s.day(u, classId, date); }
  @Put('day') @Perm('absensi.input') save(@CurrentUser() u: AuthUser, @Body() dto: SaveDayDto) { return this.s.saveDay(u, dto); }
  @Get('recap') @Perm('absensi.lihat') recap(@CurrentUser() u: AuthUser, @Query('classId', ParseIntPipe) classId: number, @Query('month') m?: string) { return this.s.recap(u, classId, m); }
  @Get('per-class') @Perm('absensi.lihat') perClass(@CurrentUser() u: AuthUser, @Query('month') m?: string, @Query('branchId') b?: string) { return this.s.perClass(u, m, b ? Number(b) : undefined); }
  @Get('students/:id') @Perm('absensi.lihat') student(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Query('month') m?: string) { return this.s.student(u, id, m); }
  @Post('students/:id/wa') @Perm('absensi.input') wa(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.s.logWa(u, id); }
  @Get('export.pdf') @Perm('absensi.ekspor') exportPdf(@CurrentUser() u: AuthUser, @Res() res: Response, @Query('classId', ParseIntPipe) c: number, @Query('month') m?: string) { return this.s.exportReport(u, res, 'pdf', c, m); }
  @Get('export.xlsx') @Perm('absensi.ekspor') exportXlsx(@CurrentUser() u: AuthUser, @Res() res: Response, @Query('classId', ParseIntPipe) c: number, @Query('month') m?: string) { return this.s.exportReport(u, res, 'xlsx', c, m); }
}

@Module({ controllers: [AbsensiController], providers: [AbsensiService, AuditService], exports: [AbsensiService] })
export class AbsensiModule {}
