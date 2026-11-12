import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Logger, Module, NotFoundException, OnModuleDestroy, OnModuleInit, Param, ParseIntPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { PoolClient } from 'pg';
import { createHash, randomBytes } from 'crypto';
import { Db } from '../../db/db.module';
import type { AuthUser } from '../../common/auth';
import { CurrentUser, Perm, Public } from '../../common/auth';
import { AuditService } from '../../common/audit.service';
import { StorageService, sniffImage } from '../../common/storage.service';
import { SENSITIVE_ROLES } from '../../common/permissions';
import { academicYearStart, addMonths, monthLabel, monthStart, rupiah, todayWIB } from '../../common/time';
import { SettingsService, renderWa } from '../settings/settings.module';
import { printedBy, rp, sendPdf, sendXlsx } from '../../common/report';
import type { Sheet } from '../../common/report';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** Jenis tagihan yang dibukukan di menu SPP (pendaftaran → menu Pendaftaran, barang → menu Kas) */
export const SPP_MENU_TYPES = ['SPP', 'DAFTAR_ULANG'];
const TYPE_LABEL: Record<string, string> = { SPP: 'SPP', DAFTAR_ULANG: 'Daftar ulang / biaya pindah', PENDAFTARAN: 'Pendaftaran', BARANG: 'Barang' };
const STATUS_LABEL: Record<string, string> = { LUNAS: 'Lunas', MENUNGGU: 'Menunggu verifikasi', BELUM: 'Belum bayar', TUNGGAKAN: 'Tunggakan', TIDAK_DITAGIH: 'Tidak ditagih', TERJADWAL: 'Terjadwal' };
const MAX_PROOF = 5 * 1024 * 1024;

/**
 * Status tagihan diturunkan dari alokasi pembayaran (tidak disimpan):
 * LUNAS (terverifikasi ≥ nominal) · MENUNGGU (ada pembayaran menunggu verifikasi) · TUNGGAKAN (periode sebelum bulan ini) · BELUM.
 * Tagihan berjatuh tempo (cicilan pendaftaran): TUNGGAKAN bila lewat jatuh tempo (per hari), TERJADWAL bila jatuh temponya bulan depan
 * atau setelahnya (belum ditagihkan ke wali; bisa dilunasi lebih awal di menu Bayar/Pendaftaran).
 */
const INVOICE_STATUS_SQL = `
  WITH paid AS (
    SELECT a.invoice_id,
      COALESCE(SUM(a.amount) FILTER (WHERE p.state = 'TERVERIFIKASI'), 0) AS ok,
      COALESCE(SUM(a.amount) FILTER (WHERE p.state = 'MENUNGGU'), 0) AS pending
    FROM payment_allocations a JOIN payments p ON p.id = a.payment_id GROUP BY a.invoice_id)
  SELECT i.*, COALESCE(pd.ok, 0)::int AS paid_ok, COALESCE(pd.pending, 0)::int AS paid_pending,
    CASE WHEN COALESCE(pd.ok,0) >= i.amount THEN 'LUNAS'
         WHEN COALESCE(pd.ok,0) + COALESCE(pd.pending,0) >= i.amount THEN 'MENUNGGU'
         WHEN i.due_date IS NOT NULL AND i.due_date < $TODAY THEN 'TUNGGAKAN'
         WHEN i.due_date IS NOT NULL AND i.due_date >= $NEXT THEN 'TERJADWAL'
         WHEN i.due_date IS NULL AND i.period < $MONTH THEN 'TUNGGAKAN' ELSE 'BELUM' END AS status
  FROM invoices i LEFT JOIN paid pd ON pd.invoice_id = i.id WHERE i.voided_at IS NULL`;

@Injectable()
export class BillingService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Billing');
  private timer: any;
  constructor(private db: Db, private audit: AuditService, private storage: StorageService, private settings: SettingsService) {}

  // ---------------- Tagihan otomatis ----------------
  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === 'true') return;
    const run = () => this.generateMonthly().catch((e) => this.log.error(e));
    setTimeout(run, 2000);                       // saat start: pastikan tagihan bulan berjalan ada (idempotent)
    this.timer = setInterval(run, 60 * 60_000);  // tiap jam; pergantian bulan tertangkap otomatis
  }
  onModuleDestroy() { clearInterval(this.timer); }

  /** SPP tanggal 1: santri Aktif (termasuk yang pengajuannya menunggu) yang sudah masuk per tgl 1. Cuti/Indent tidak ditagih. */
  async generateMonthly(period = monthStart(), client?: PoolClient) { // client: dipakai `bun run test:bill` (pratinjau di-rollback)
    const n = await this.db.exec(
      `INSERT INTO invoices(student_id, family_id, branch_id, type, period, label, amount, note)
       SELECT s.id, s.family_id, s.branch_id, 'SPP', $1::date, $2, s.spp_rate, s.subsidy_label FROM students s
       WHERE s.status = 'AKTIF' AND s.spp_rate > 0 AND s.join_date <= $1::date
       ON CONFLICT (student_id, type, period) WHERE voided_at IS NULL AND type <> 'BARANG' DO NOTHING`, [period, `SPP ${monthLabel(period)}`], client);
    if (n) this.log.log(`${n} tagihan SPP ${monthLabel(period)} dibuat`);
    return { created: n, period };
  }
  /**
   * Picu manual (menu SPP): sama persis dengan penjadwal tanggal 1, untuk bulan tertentu. Maksimal satu bulan ke depan
   * (menyiapkan tagihan bulan depan / uji "seakan-akan tanggal 1"); tercatat di audit.
   */
  async generateManual(actor: AuthUser, month?: string) {
    if (month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('Format bulan harus YYYY-MM, mis. 2026-12');
    const period = month ? month + '-01' : monthStart();
    if (period > addMonths(monthStart(), 1)) throw new BadRequestException(`Tagihan SPP paling jauh untuk bulan depan (${monthLabel(addMonths(monthStart(), 1))})`);
    const r = await this.generateMonthly(period);
    await this.audit.log(actor.id, 'generate', 'invoice', null, null, { type: 'SPP', period, count: r.created });
    return r;
  }
  /** Daftar ulang (nominal & bulan mulai dari menu Pengaturan) di awal tahun pembelajaran: santri Aktif & Cuti (tidak ditagih dua kali). */
  async generateReregistration(actor: AuthUser) {
    const cfg = await this.settings.get();
    const start = academicYearStart(cfg.academicYearStartMonth);
    const amount = cfg.reregistrationFee;
    const n = await this.db.exec(
      `INSERT INTO invoices(student_id, family_id, branch_id, type, period, label, amount)
       SELECT s.id, s.family_id, s.branch_id, 'DAFTAR_ULANG', $1::date, $2, $3 FROM students s
       WHERE s.status IN ('AKTIF','CUTI')
       AND NOT EXISTS (SELECT 1 FROM invoices x WHERE x.student_id = s.id AND x.type = 'DAFTAR_ULANG' AND x.voided_at IS NULL AND x.period > $1::date - interval '6 months' AND x.period < $1::date + interval '6 months')
       ON CONFLICT (student_id, type, period) WHERE voided_at IS NULL AND type <> 'BARANG' DO NOTHING`, [start, `Daftar ulang ${start.slice(0, 4)}/${Number(start.slice(0, 4)) + 1}`, amount]);
    await this.audit.log(actor.id, 'generate', 'invoice', null, null, { type: 'DAFTAR_ULANG', count: n });
    return { created: n };
  }

  invoicesSql(where = '', params: any[] = []) {
    // nilai tanggal dari server (bukan input pengguna), aman disisipkan
    const sql = INVOICE_STATUS_SQL.replace('$MONTH', `'${monthStart()}'::date`).replace('$TODAY', `'${todayWIB()}'::date`).replace('$NEXT', `'${addMonths(monthStart(), 1)}'::date`);
    return { sql: `SELECT * FROM (${sql}) x ${where}`, params };
  }

  // ---------------- Menu SPP (rekap) ----------------
  async sppSummary(user: AuthUser, month?: string, branchId?: number) {
    const period = (month ?? monthStart().slice(0, 7)) + '-01';
    const ids = this.ids(user, branchId);
    const { sql } = this.invoicesSql(`WHERE type = 'SPP' AND period = $1 AND ($2::int[] IS NULL OR branch_id = ANY($2))`);
    const inv = await this.db.many(sql, [period, ids]);
    const count = (st: string) => inv.filter((i) => i.status === st).length;
    const sum = (k: string) => inv.reduce((a, i) => a + i[k], 0);
    const branches = await this.db.many('SELECT id, name FROM branches WHERE ($1::int[] IS NULL OR id = ANY($1)) ORDER BY id', [ids]);
    // pembukuan terpisah: menu SPP = SPP + daftar ulang/biaya pindah (pendaftaran & barang punya menunya sendiri)
    const { sql: tsql } = this.invoicesSql(`WHERE type = ANY($2) AND status = 'TUNGGAKAN' AND ($1::int[] IS NULL OR branch_id = ANY($1))`);
    const overdue = await this.db.many(tsql, [ids, SPP_MENU_TYPES]);
    const du = await this.reregistration(ids);
    return {
      period, label: monthLabel(period), total: inv.length,
      counts: { LUNAS: count('LUNAS'), MENUNGGU: count('MENUNGGU'), BELUM: count('BELUM'), TUNGGAKAN: count('TUNGGAKAN') },
      money: { tagihan: sum('amount'), terbayar: sum('paid_ok'), menunggu: sum('paid_pending'), tunggakan: overdue.reduce((a, i) => a + i.amount - i.paid_ok, 0), keluargaTunggakan: new Set(overdue.map((i) => i.family_id)).size },
      daftarUlang: { label: du.label, santri: du.rows.length, tagihan: du.rows.reduce((a, i) => a + i.amount, 0), terbayar: du.rows.reduce((a, i) => a + i.paid_ok, 0),
        menunggu: du.rows.reduce((a, i) => a + i.paid_pending, 0), lunas: du.rows.filter((i) => i.status === 'LUNAS').length },
      branches: branches.map((b) => ({ ...b, total: inv.filter((i) => i.branch_id === b.id).length, lunas: inv.filter((i) => i.branch_id === b.id && i.status === 'LUNAS').length })),
    };
  }
  /** Tagihan daftar ulang & biaya pindah tahun pembelajaran berjalan */
  private async reregistration(ids: number[] | null) {
    const cfg = await this.settings.get();
    const start = academicYearStart(cfg.academicYearStartMonth);
    const { sql } = this.invoicesSql(`WHERE type = 'DAFTAR_ULANG' AND period >= $2 AND period < $3 AND ($1::int[] IS NULL OR branch_id = ANY($1)) ORDER BY period, id`);
    const rows = await this.db.many(sql, [ids, start, addMonths(start, 12)]);
    return { label: `${start.slice(0, 4)}/${Number(start.slice(0, 4)) + 1}`, rows };
  }

  async sppStudents(user: AuthUser, p: { month?: string; status?: string; q?: string; branchId?: number }) {
    const period = (p.month ?? monthStart().slice(0, 7)) + '-01';
    const ids = this.ids(user, p.branchId);
    const months = [5, 4, 3, 2, 1, 0].map((k) => addMonths(period, -k));
    const students = await this.db.many(
      `SELECT s.id, s.full_name AS "fullName", s.status, c.name AS "className", f.father_name AS wali, s.family_id AS "familyId"
       FROM students s JOIN classes c ON c.id = s.class_id JOIN families f ON f.id = s.family_id
       WHERE ($1::int[] IS NULL OR s.branch_id = ANY($1)) AND s.status <> 'KELUAR' AND ($2::text IS NULL OR s.full_name ILIKE $2 OR f.father_name ILIKE $2)
       ORDER BY s.full_name`, [ids, p.q ? `%${p.q}%` : null]);
    const { sql } = this.invoicesSql(`WHERE ($1::int[] IS NULL OR branch_id = ANY($1))`);
    const inv = await this.db.many(sql, [ids]);
    const rows = students.map((s) => {
      const mine = inv.filter((i) => i.student_id === s.id);
      const spp = (m: string) => mine.find((i) => i.type === 'SPP' && i.period === m);
      const cur = spp(period);
      // ada tagihan bulan lalu yang belum lunas → tampil sebagai Tunggakan (kecuali buktinya sedang diverifikasi)
      const overdue = mine.some((i) => i.status === 'TUNGGAKAN' && SPP_MENU_TYPES.includes(i.type));
      const status = overdue ? 'TUNGGAKAN' : cur ? cur.status : 'TIDAK_DITAGIH';
      const hist = months.map((m) => ({ month: m, status: spp(m)?.status ?? 'TIDAK_DITAGIH' }));
      const sisa = mine.filter((i) => i.status !== 'LUNAS' && i.status !== 'TERJADWAL' && SPP_MENU_TYPES.includes(i.type)).reduce((a, i) => a + i.amount - i.paid_ok, 0);
      // label subsidi sensitif: hanya PJ & ustadzah (Manajer/Admin hanya melihat nominal)
      return { ...s, amount: cur?.amount ?? 0, note: SENSITIVE_ROLES.includes(user.role) ? cur?.note ?? null : null, status, hist, sisa };
    });
    return { period, months, rows: p.status ? rows.filter((r) => r.status === p.status) : rows };
  }

  /** Ekspor menu SPP (Excel/PDF): rekap per santri bulan itu, pembayaran SPP & daftar ulang bulan itu, daftar ulang tahun berjalan. Tanpa label subsidi. */
  async sppExport(user: AuthUser, res: Response, fmt: 'xlsx' | 'pdf', month?: string, branchId?: number) {
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('Format bulan harus YYYY-MM');
    const ids = this.ids(user, branchId);
    const sum = await this.sppSummary(user, month, branchId);
    const list = await this.sppStudents(user, { month, branchId });
    const st = list.rows.length ? await this.db.many('SELECT s.id, s.nis, b.name AS branch FROM students s JOIN branches b ON b.id = s.branch_id WHERE s.id = ANY($1)', [list.rows.map((r: any) => r.id)]) : [];
    const pays = await this.db.many(
      `SELECT p.paid_at, p.method, p.state, a.amount, i.label, i.type, s.full_name, f.father_name, b.name AS branch, u.name AS recorded_by
       FROM payment_allocations a JOIN payments p ON p.id = a.payment_id JOIN invoices i ON i.id = a.invoice_id JOIN students s ON s.id = i.student_id
       JOIN families f ON f.id = i.family_id JOIN branches b ON b.id = i.branch_id LEFT JOIN users u ON u.id = p.recorded_by
       WHERE i.type = ANY($4) AND p.state IN ('TERVERIFIKASI','MENUNGGU') AND p.paid_at >= $1 AND p.paid_at < $2 AND ($3::int[] IS NULL OR i.branch_id = ANY($3))
       ORDER BY p.paid_at, s.full_name`, [sum.period, addMonths(sum.period, 1), ids, SPP_MENU_TYPES]);
    const du = await this.reregistration(ids);
    const duSt = du.rows.length ? await this.db.many('SELECT s.id, s.full_name, b.name AS branch FROM students s JOIN branches b ON b.id = s.branch_id WHERE s.id = ANY($1)', [du.rows.map((i) => i.student_id)]) : [];
    const branch = branchId ? (await this.db.one('SELECT name FROM branches WHERE id = $1', [branchId]))?.name : user.branchIds ? 'cabang Anda' : 'semua cabang';
    await this.db.exec('INSERT INTO export_logs(user_id, report, filters) VALUES ($1,$2,$3)', [user.id, `spp_${fmt}`, JSON.stringify({ month: sum.period.slice(0, 7), branchId: branchId ?? null })]);
    const okPays = pays.filter((p) => p.state === 'TERVERIFIKASI');
    const meta = {
      title: `Laporan SPP — ${sum.label}`, subtitle: `Rumah Tahfidz Al-Fatihah · ${branch} · ${printedBy(user.name)}`,
      summary: [['Santri ditagih', `${sum.total} (lunas ${sum.counts.LUNAS})`], ['Tagihan SPP', rp(sum.money.tagihan)], ['Terbayar', rp(sum.money.terbayar)], ['Menunggu verifikasi', rp(sum.money.menunggu)],
        ['Tunggakan (semua bulan)', rp(sum.money.tunggakan)], ['Uang masuk bulan ini (SPP + daftar ulang)', rp(okPays.reduce((a, p) => a + p.amount, 0))]] as [string, string][],
    };
    const sheets: Sheet[] = [
      { name: `Rekap SPP ${sum.label}`, columns: [
          { header: 'No', key: 'no', width: 5 }, { header: 'ID santri', key: 'nis', width: 13 }, { header: 'Nama santri', key: 'fullName', width: 26 }, { header: 'Cabang', key: 'branch', width: 13 },
          { header: 'Kelas', key: 'className', width: 13 }, { header: 'Wali', key: 'wali', width: 22 }, { header: 'Tagihan bulan ini', key: 'amount', width: 15, money: true },
          { header: 'Status', key: 'status', width: 16 }, { header: 'Belum dibayar (semua bulan)', key: 'sisa', width: 17, money: true }],
        rows: list.rows.map((r: any, k: number) => { const x = st.find((s) => s.id === r.id); return { no: k + 1, nis: x?.nis, fullName: r.fullName, branch: x?.branch, className: r.className, wali: r.wali, amount: r.amount || '', status: STATUS_LABEL[r.status] ?? r.status, sisa: r.sisa }; }),
        totals: { fullName: 'Total', amount: list.rows.reduce((a: number, r: any) => a + (r.amount || 0), 0), sisa: list.rows.reduce((a: number, r: any) => a + r.sisa, 0) } },
      { name: `Pembayaran ${sum.label}`, columns: [
          { header: 'Tanggal', key: 'paid_at', width: 11, date: true }, { header: 'Santri', key: 'full_name', width: 24 }, { header: 'Wali', key: 'father_name', width: 20 }, { header: 'Cabang', key: 'branch', width: 12 },
          { header: 'Tagihan', key: 'label', width: 22 }, { header: 'Nominal', key: 'amount', width: 13, money: true }, { header: 'Cara bayar', key: 'method', width: 11 }, { header: 'Status', key: 'stateLabel', width: 16 }, { header: 'Dicatat oleh', key: 'recorded_by', width: 16 }],
        rows: pays.map((p) => ({ ...p, method: p.method === 'TUNAI' ? 'Tunai' : 'Transfer', stateLabel: p.state === 'TERVERIFIKASI' ? 'Terverifikasi' : 'Menunggu verifikasi', recorded_by: p.recorded_by ?? 'Wali (link)' })),
        totals: { full_name: 'Total terverifikasi', amount: okPays.reduce((a, p) => a + p.amount, 0) } },
      { name: `Daftar ulang ${du.label}`, columns: [
          { header: 'Santri', key: 'name', width: 26 }, { header: 'Cabang', key: 'branch', width: 13 }, { header: 'Tagihan', key: 'label', width: 26 }, { header: 'Nominal', key: 'amount', width: 13, money: true },
          { header: 'Terbayar', key: 'paid_ok', width: 13, money: true }, { header: 'Status', key: 'status', width: 16 }],
        rows: du.rows.map((i) => { const x = duSt.find((s) => s.id === i.student_id); return { name: x?.full_name, branch: x?.branch, label: i.label, amount: i.amount, paid_ok: i.paid_ok, status: STATUS_LABEL[i.status] ?? i.status }; }),
        totals: { name: 'Total', amount: du.rows.reduce((a, i) => a + i.amount, 0), paid_ok: du.rows.reduce((a, i) => a + i.paid_ok, 0) } },
    ];
    const file = `spp-${sum.period.slice(0, 7)}`;
    if (fmt === 'xlsx') return sendXlsx(res, file, meta, sheets);
    sendPdf(res, file, meta, sheets, { landscape: true, footnote: 'Uang pendaftaran ada di laporan menu Pendaftaran; penjualan barang & pengeluaran di laporan menu Kas.' });
  }

  /** Tagihan satu santri (tab Tagihan di detail santri) */
  async studentInvoices(user: AuthUser, studentId: number) {
    const st = await this.db.one('SELECT id FROM students WHERE id = $1 AND ($2::int[] IS NULL OR branch_id = ANY($2))', [studentId, user.branchIds]);
    if (!st) throw new NotFoundException('Santri tidak ditemukan');
    const { sql } = this.invoicesSql('WHERE student_id = $1 ORDER BY period DESC, id DESC');
    const rows = await this.db.many(sql, [studentId]);
    return rows.map((i) => ({ id: i.id, type: i.type, label: i.label, amount: i.amount, paid: i.paid_ok, status: i.status, period: i.period, dueDate: i.due_date }));
  }

  // ---------------- Menu Bayar ----------------
  async families(user: AuthUser, q?: string) {
    const ids = this.ids(user);
    const { sql } = this.invoicesSql(`WHERE status IN ('BELUM','TUNGGAKAN','MENUNGGU') AND ($1::int[] IS NULL OR branch_id = ANY($1))`);
    const open = await this.db.many(sql, [ids]);
    const famIds = [...new Set(open.map((i) => i.family_id))];
    if (!famIds.length) return [];
    const fams = await this.db.many(
      `SELECT f.id, f.father_name AS "fatherName", f.mother_name AS "motherName", f.wa_phone AS "waPhone",
         (SELECT MAX(created_at) FROM wa_dispatch_log w WHERE w.family_id = f.id) AS "lastSent",
         (SELECT COUNT(*) FROM payments p WHERE p.family_id = f.id AND p.state = 'MENUNGGU')::int AS pending
       FROM families f WHERE f.id = ANY($1) AND ($2::text IS NULL OR f.father_name ILIKE $2 OR f.mother_name ILIKE $2) ORDER BY f.father_name`, [famIds, q ? `%${q}%` : null]);
    const kids = await this.db.many(`SELECT id, family_id, nickname, full_name FROM students WHERE family_id = ANY($1) AND ($2::int[] IS NULL OR branch_id = ANY($2))`, [famIds, ids]);
    return fams.map((f) => {
      const mine = open.filter((i) => i.family_id === f.id);
      const due = mine.filter((i) => i.status !== 'MENUNGGU');
      return { ...f, kids: kids.filter((k) => k.family_id === f.id).map((k) => k.nickname || k.full_name.split(' ')[0]),
        total: due.reduce((a, i) => a + i.amount - i.paid_ok, 0), count: due.length,
        status: due.some((i) => i.status === 'TUNGGAKAN') ? 'TUNGGAKAN' : due.length ? 'BELUM' : 'MENUNGGU' };
    }).filter((f) => f.total > 0 || f.pending > 0);
  }

  /** Tagihan terbuka keluarga. scheduled: ikut cicilan yang belum jatuh tempo (catat bayar / lunasi lebih awal); kirim WA tidak. */
  async familyInvoices(user: AuthUser, familyId: number, scheduled = false) {
    const ids = this.ids(user);
    const { sql } = this.invoicesSql(`WHERE family_id = $1 AND status = ANY($3) AND ($2::int[] IS NULL OR branch_id = ANY($2)) ORDER BY COALESCE(due_date, period), id`);
    const rows = await this.db.many(sql, [familyId, ids, scheduled ? ['BELUM', 'TUNGGAKAN', 'TERJADWAL'] : ['BELUM', 'TUNGGAKAN']]);
    const kids = await this.db.many('SELECT id, nickname, full_name FROM students WHERE family_id = $1', [familyId]);
    return rows.map((i) => ({ id: i.id, type: i.type, label: i.label, amount: i.amount - i.paid_ok, status: i.status, note: i.note, dueDate: i.due_date,
      student: (kids.find((k) => k.id === i.student_id)?.nickname) || kids.find((k) => k.id === i.student_id)?.full_name }));
  }

  /** Buat link tagihan bertoken (masa berlaku & template WA dari menu Pengaturan, link lama dicabut). */
  async createLink(user: AuthUser, familyId: number) {
    const inv = await this.familyInvoices(user, familyId);
    if (!inv.length) throw new BadRequestException('Keluarga ini tidak punya tagihan terbuka');
    const f = await this.db.one('SELECT id, wa_phone FROM families WHERE id = $1', [familyId]);
    const cfg = await this.settings.get();
    const raw = randomBytes(24).toString('base64url');
    await this.db.tx(async (c) => {
      await c.query('UPDATE payment_links SET revoked = true WHERE family_id = $1 AND revoked = false', [familyId]);
      await c.query(`INSERT INTO payment_links(family_id, token_hash, expires_at, created_by) VALUES ($1,$2, now() + make_interval(days => $4), $3)`, [familyId, sha(raw), user.id, cfg.linkDays]);
      await c.query('INSERT INTO wa_dispatch_log(family_id, user_id, total) VALUES ($1,$2,$3)', [familyId, user.id, inv.reduce((a, i) => a + i.amount, 0)]);
    });
    const base = (process.env.PUBLIC_WEB_URL ?? 'http://localhost:5173').replace(/\/$/, '');
    const url = `${base}/bayar/${raw}`;
    const names = [...new Set(inv.map((i) => i.student))].join(' & ');
    const periods = inv.filter((i) => i.type === 'SPP').map((i) => i.label.replace('SPP ', '').split(' ')[0]);
    const what = periods.length ? `SPP ${periods.length > 1 ? `${periods[0]}–${periods[periods.length - 1]}` : periods[0]}` : inv[0].label;
    const total = inv.reduce((a, i) => a + i.amount, 0);
    const message = renderWa(cfg.waTemplate, { tagihan: what, nama: names, total: rupiah(total), link: url });
    const phone = f!.wa_phone.replace(/^0/, '62');
    await this.audit.log(user.id, 'kirim_tagihan', 'family', familyId, null, { total });
    return { url, message, waUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`, total };
  }

  /** Catat pembayaran (tunai / bukti dari WA). Entri dari pengguna tanpa izin verifikasi masuk antrean MENUNGGU. */
  async recordPayment(user: AuthUser, body: any, file?: Express.Multer.File) {
    const familyId = Number(body.familyId), amount = Number(body.amount);
    const invoiceIds: number[] = String(body.invoiceIds ?? '').split(',').map(Number).filter(Boolean);
    const method = body.method === 'TUNAI' ? 'TUNAI' : 'TRANSFER';
    const source = method === 'TUNAI' ? 'TUNAI' : 'WA';
    if (!familyId || !invoiceIds.length) throw new BadRequestException('Pilih minimal satu tagihan');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.paidAt ?? '')) throw new BadRequestException('Tanggal bayar tidak valid');
    const open = await this.familyInvoices(user, familyId, true); // cicilan terjadwal boleh dilunasi lebih awal
    const chosen = open.filter((i) => invoiceIds.includes(i.id));
    if (chosen.length !== invoiceIds.length) throw new BadRequestException('Ada tagihan yang tidak valid atau sudah lunas');
    const due = chosen.reduce((a, i) => a + i.amount, 0);
    if (amount !== due) throw new BadRequestException(`Nominal harus sama dengan total tagihan terpilih (${rupiah(due)}). Pembayaran sebagian belum didukung.`);
    let proof: string | null = null;
    if (file) proof = await this.saveProof(file);
    if (method === 'TRANSFER' && !proof) throw new BadRequestException('Bukti transfer wajib diunggah');
    const canVerify = user.perms.includes('bayar.setujui') && String(body.matched) === 'true';
    const pay = await this.db.tx(async (c) => {
      const p = (await c.query(
        `INSERT INTO payments(family_id, amount, paid_at, method, source, state, proof_path, note, recorded_by, verified_by, verified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, state`,
        [familyId, amount, body.paidAt, method, source, canVerify ? 'TERVERIFIKASI' : 'MENUNGGU', proof, body.note || null, user.id, canVerify ? user.id : null, canVerify ? new Date() : null])).rows[0];
      for (const i of chosen) await c.query('INSERT INTO payment_allocations(payment_id, invoice_id, amount) VALUES ($1,$2,$3)', [p.id, i.id, i.amount]);
      return p;
    });
    await this.audit.log(user.id, 'catat_bayar', 'payment', pay.id, null, { familyId, amount, method, invoiceIds, state: pay.state });
    return pay;
  }

  async saveProof(file: Express.Multer.File) {
    if (file.size > MAX_PROOF) throw new BadRequestException('Ukuran file terlalu besar (maks. 5 MB)');
    const kind = sniffImage(file.buffer);
    if (!kind) throw new BadRequestException('Format harus JPG, PNG, WebP, atau PDF');
    return this.storage.put('bukti', file.buffer, kind.ext);
  }

  async payments(user: AuthUser, state?: string) {
    const ids = this.ids(user);
    return this.db.many(
      `SELECT p.id, p.amount, p.paid_at AS "paidAt", p.method, p.source, p.state, p.note, p.cancel_reason AS "cancelReason", p.created_at AS "createdAt",
              (p.proof_path IS NOT NULL) AS "hasProof", f.id AS "familyId", f.father_name AS "fatherName", r.name AS "recordedBy", v.name AS "verifiedBy",
              (SELECT string_agg(i.label || ' · ' || COALESCE(s.nickname, s.full_name), ', ') FROM payment_allocations a JOIN invoices i ON i.id = a.invoice_id JOIN students s ON s.id = i.student_id WHERE a.payment_id = p.id) AS items
       FROM payments p JOIN families f ON f.id = p.family_id LEFT JOIN users r ON r.id = p.recorded_by LEFT JOIN users v ON v.id = p.verified_by
       WHERE ($1::text IS NULL OR p.state = $1)
         AND ($2::int[] IS NULL OR EXISTS (SELECT 1 FROM payment_allocations a JOIN invoices i ON i.id = a.invoice_id WHERE a.payment_id = p.id AND i.branch_id = ANY($2)))
       ORDER BY p.created_at DESC LIMIT 100`, [state || null, ids]);
  }

  private async scopedPayment(user: AuthUser, id: number) {
    const p = await this.db.one(
      `SELECT p.* FROM payments p WHERE p.id = $1 AND ($2::int[] IS NULL OR EXISTS (SELECT 1 FROM payment_allocations a JOIN invoices i ON i.id = a.invoice_id WHERE a.payment_id = p.id AND i.branch_id = ANY($2)))`, [id, this.ids(user)]);
    if (!p) throw new NotFoundException('Pembayaran tidak ditemukan');
    return p;
  }
  async verify(user: AuthUser, id: number) {
    const p = await this.scopedPayment(user, id);
    if (p.state !== 'MENUNGGU') throw new BadRequestException('Pembayaran ini tidak sedang menunggu verifikasi');
    await this.db.exec(`UPDATE payments SET state = 'TERVERIFIKASI', verified_by = $2, verified_at = now() WHERE id = $1`, [id, user.id]);
    await this.audit.log(user.id, 'verifikasi', 'payment', id, { state: 'MENUNGGU' }, { state: 'TERVERIFIKASI' });
    return { ok: true };
  }
  /** Tolak (menunggu) atau batalkan (terverifikasi). Entri tidak dihapus; alasan wajib. */
  async cancel(user: AuthUser, id: number, reason?: string) {
    if (!reason || reason.trim().length < 3) throw new BadRequestException('Alasan wajib diisi');
    const p = await this.scopedPayment(user, id);
    if (p.state === 'DIBATALKAN') throw new BadRequestException('Pembayaran sudah dibatalkan');
    await this.db.exec(`UPDATE payments SET state = 'DIBATALKAN', cancel_reason = $2, canceled_by = $3 WHERE id = $1`, [id, reason.trim(), user.id]);
    await this.audit.log(user.id, 'batal_bayar', 'payment', id, { state: p.state }, { state: 'DIBATALKAN', reason });
    return { ok: true };
  }
  async proof(user: AuthUser, id: number, res: Response) {
    const p = await this.scopedPayment(user, id);
    if (!p.proof_path) throw new NotFoundException('Tidak ada bukti');
    const buf = await this.storage.get(p.proof_path);
    res.setHeader('Content-Type', sniffImage(buf)?.mime ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }

  // ---------------- Halaman publik wali ----------------
  private async linkFamily(token: string) {
    const l = await this.db.one('SELECT * FROM payment_links WHERE token_hash = $1', [sha(token)]);
    if (!l || l.revoked || new Date(l.expires_at) < new Date()) throw new NotFoundException('Link tidak berlaku. Silakan minta link baru ke ustadzah.');
    return l.family_id as number;
  }
  async publicBills(token: string) { return this.familyBills(await this.linkFamily(token)); }
  async publicUpload(token: string, file?: Express.Multer.File) { return this.familyUpload(await this.linkFamily(token), null, file); }

  // ---------------- Tagihan keluarga (halaman publik wali & portal akun wali): data minimum, tanpa label subsidi ----------------
  async familyBills(familyId: number) {
    const { sql } = this.invoicesSql(`WHERE family_id = $1 AND status IN ('BELUM','TUNGGAKAN','MENUNGGU') ORDER BY period, id`);
    const inv = await this.db.many(sql, [familyId]);
    const kids = await this.db.many('SELECT id, nickname, full_name FROM students WHERE family_id = $1', [familyId]);
    const bills = inv.map((i) => ({ who: kids.find((k) => k.id === i.student_id)?.nickname || kids.find((k) => k.id === i.student_id)?.full_name.split(' ')[0], label: i.label, amount: i.amount - i.paid_ok, status: i.status }));
    const due = bills.filter((b) => b.status !== 'MENUNGGU');
    // rekening cabang dari tagihan yang perlu dibayar (bila kosong: cabang anak yang masih terdaftar); satu rekening per nomor
    const dueInv = inv.filter((i) => i.status !== 'MENUNGGU');
    let branchIds = [...new Set(dueInv.map((i) => i.branch_id as number))];
    if (!branchIds.length) branchIds = (await this.db.many(`SELECT DISTINCT branch_id FROM students WHERE family_id = $1 AND status <> 'KELUAR'`, [familyId])).map((r) => r.branch_id);
    const banks: { name: string; account: string; holder: string; branches: string[]; total: number }[] = [];
    for (const b of await this.settings.banks(branchIds)) {
      const total = dueInv.filter((i) => i.branch_id === b.branchId).reduce((a, i) => a + i.amount - i.paid_ok, 0);
      const same = banks.find((x) => x.account === b.account && x.name === b.name);
      if (same) { same.branches.push(b.branchName); same.total += total; }
      else banks.push({ name: b.name, account: b.account, holder: b.holder, branches: [b.branchName], total });
    }
    return { bills, total: due.reduce((a, b) => a + b.amount, 0), waiting: bills.some((b) => b.status === 'MENUNGGU'), banks, bank: banks[0] };
  }
  async familyUpload(familyId: number, actorId: number | null, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Pilih foto bukti transfer');
    const { sql } = this.invoicesSql(`WHERE family_id = $1 AND status IN ('BELUM','TUNGGAKAN') ORDER BY period, id`);
    const inv = await this.db.many(sql, [familyId]);
    if (!inv.length) throw new BadRequestException('Tidak ada tagihan yang perlu dibayar');
    const proof = await this.saveProof(file);
    const total = inv.reduce((a, i) => a + i.amount - i.paid_ok, 0);
    const p = await this.db.tx(async (c) => {
      const row = (await c.query(`INSERT INTO payments(family_id, amount, paid_at, method, source, state, proof_path) VALUES ($1,$2,$3,'TRANSFER','WEB','MENUNGGU',$4) RETURNING id, created_at`, [familyId, total, todayWIB(), proof])).rows[0];
      for (const i of inv) await c.query('INSERT INTO payment_allocations(payment_id, invoice_id, amount) VALUES ($1,$2,$3)', [row.id, i.id, i.amount - i.paid_ok]);
      return row;
    });
    await this.audit.log(actorId, 'unggah_bukti_wali', 'payment', p.id, null, { familyId, total });
    return { ok: true, total, createdAt: p.created_at };
  }

  // ---------------- Ringkasan untuk dashboard ----------------
  async dashboard(branchIds: number[] | null) {
    const period = monthStart();
    const { sql } = this.invoicesSql(`WHERE ($1::int[] IS NULL OR branch_id = ANY($1))`);
    const inv = await this.db.many(sql, [branchIds]);
    const cur = inv.filter((i) => i.period === period && i.type === 'SPP'); // "sudah bayar SPP bulan ini": hanya tagihan SPP (pembukuan terpisah)
    const pend = await this.db.one(`SELECT COUNT(*)::int AS n FROM payments p WHERE p.state = 'MENUNGGU' AND ($1::int[] IS NULL OR EXISTS (SELECT 1 FROM payment_allocations a JOIN invoices i ON i.id = a.invoice_id WHERE a.payment_id = p.id AND i.branch_id = ANY($1)))`, [branchIds]);
    return {
      tagihan: cur.reduce((a, i) => a + i.amount, 0), terbayar: cur.reduce((a, i) => a + i.paid_ok, 0),
      belum: cur.filter((i) => i.status === 'BELUM').reduce((a, i) => a + i.amount - i.paid_ok, 0),
      tunggakan: inv.filter((i) => i.status === 'TUNGGAKAN').reduce((a, i) => a + i.amount - i.paid_ok, 0),
      lunasSantri: cur.filter((i) => i.status === 'LUNAS').length, totalSantri: cur.length,
      keluargaBelum: new Set(inv.filter((i) => i.status === 'BELUM' || i.status === 'TUNGGAKAN').map((i) => i.family_id)).size,
      buktiMenunggu: pend!.n,
    };
  }

  private ids(user: AuthUser, branchId?: number) {
    if (user.branchIds) return branchId ? user.branchIds.filter((b) => b === Number(branchId)) : user.branchIds;
    return branchId ? [Number(branchId)] : null;
  }
}

@Controller()
export class BillingController {
  constructor(private s: BillingService) {}
  // SPP (rekap)
  @Get('spp/summary') @Perm('spp.lihat') summary(@CurrentUser() u: AuthUser, @Query('month') m?: string, @Query('branchId') b?: number) { return this.s.sppSummary(u, m, b); }
  @Get('spp/export.xlsx') @Perm('spp.ekspor') sppXlsx(@CurrentUser() u: AuthUser, @Res() res: Response, @Query('month') m?: string, @Query('branchId') b?: string) { return this.s.sppExport(u, res, 'xlsx', m || undefined, b ? Number(b) : undefined); }
  @Get('spp/export.pdf') @Perm('spp.ekspor') sppPdf(@CurrentUser() u: AuthUser, @Res() res: Response, @Query('month') m?: string, @Query('branchId') b?: string) { return this.s.sppExport(u, res, 'pdf', m || undefined, b ? Number(b) : undefined); }
  @Get('spp/students') @Perm('spp.lihat') students(@CurrentUser() u: AuthUser, @Query() q: any) { return this.s.sppStudents(u, q); }
  @Get('spp/students/:id/invoices') @Perm('spp.lihat') stInv(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.s.studentInvoices(u, id); }
  @Post('spp/generate') @Perm('spp.input') gen(@CurrentUser() u: AuthUser, @Query('month') m?: string) { return this.s.generateManual(u, m || undefined); }
  @Post('spp/generate-reregistration') @Perm('spp.input') regen(@CurrentUser() u: AuthUser) { return this.s.generateReregistration(u); }
  // Bayar
  @Get('bayar/families') @Perm('bayar.lihat') families(@CurrentUser() u: AuthUser, @Query('q') q?: string) { return this.s.families(u, q); }
  @Get('bayar/families/:id/invoices') @Perm('bayar.lihat') famInv(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Query('terjadwal') t?: string) { return this.s.familyInvoices(u, id, t === '1'); }
  @Post('bayar/families/:id/link') @Perm('bayar.input') link(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.s.createLink(u, id); }
  @Post('bayar/payments') @Perm('bayar.input') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PROOF } }))
  record(@CurrentUser() u: AuthUser, @Body() body: any, @UploadedFile() file?: Express.Multer.File) { return this.s.recordPayment(u, body, file); }
  @Get('bayar/payments') @Perm('bayar.lihat') payments(@CurrentUser() u: AuthUser, @Query('state') st?: string) { return this.s.payments(u, st); }
  @Post('bayar/payments/:id/verify') @Perm('bayar.setujui') verify(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.s.verify(u, id); }
  @Post('bayar/payments/:id/cancel') @Perm('bayar.setujui') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body('reason') r?: string) { return this.s.cancel(u, id, r); }
  @Get('bayar/payments/:id/proof') @Perm('bayar.lihat') proof(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Res() res: Response) { return this.s.proof(u, id, res); }
  // Publik (wali, tanpa login): dibatasi laju per IP
  @Public() @Throttle({ default: { limit: 30, ttl: 60_000 } }) @Get('public/tagihan/:token') pub(@Param('token') t: string) { return this.s.publicBills(t); }
  @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @Post('public/tagihan/:token/bukti') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PROOF } }))
  pubUpload(@Param('token') t: string, @UploadedFile() file?: Express.Multer.File) { return this.s.publicUpload(t, file); }
}

@Module({ controllers: [BillingController], providers: [BillingService, AuditService, StorageService], exports: [BillingService] })
export class BillingModule {}
