import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { Db } from '../../db/db.module';
import { CurrentUser, Perm } from '../../common/auth';
import type { AuthUser } from '../../common/auth';
import { BillingModule, BillingService } from '../billing/billing.module';
import { HafalanModule, HafalanService } from '../hafalan/hafalan.module';
import { addDays, monthLabel, monthStart, todayWIB, weekStart } from '../../common/time';
import { RegistrationModule, RegistrationService } from '../registration/registration.module';
import { KasModule, KasService } from '../kas/kas.module';

@Injectable()
export class DashboardService {
  constructor(private db: Db, private billing: BillingService, private hafalan: HafalanService, private reg: RegistrationService, private kas: KasService) {}
  /** Semua angka dihitung dari data modul. Scope: ustadzah = cabangnya; PJ/Manajer = semua, bisa filter cabang & bulan (YYYY-MM). */
  async summary(user: AuthUser, branchId?: number, month?: string) {
    const ids = user.branchIds ? user.branchIds.filter((b) => !branchId || b === Number(branchId)) : branchId ? [Number(branchId)] : null;
    const ym = month ?? new Date().toISOString().slice(0, 7);
    const st = await this.db.one(
      `SELECT COUNT(*) FILTER (WHERE status='AKTIF')::int AS aktif, COUNT(*) FILTER (WHERE status='CUTI')::int AS cuti,
              COUNT(*) FILTER (WHERE status='INDENT')::int AS indent, COUNT(*) FILTER (WHERE status='KELUAR')::int AS keluar,
              COUNT(*) FILTER (WHERE status='AKTIF' AND gender='L')::int AS putra, COUNT(*) FILTER (WHERE status='AKTIF' AND gender='P')::int AS putri
       FROM students s WHERE ($1::int[] IS NULL OR s.branch_id = ANY($1))`, [ids]);
    const k = await this.db.one(
      `SELECT COUNT(*)::int AS n FROM status_history h JOIN students s ON s.id = h.student_id
       WHERE h.to_status = 'KELUAR' AND to_char(h.effective_date, 'YYYY-MM') = $2 AND ($1::int[] IS NULL OR s.branch_id = ANY($1))`, [ids, ym]);
    const u = await this.db.one(
      `SELECT COUNT(DISTINCT u.id)::int AS n FROM users u JOIN roles r ON r.id = u.role_id JOIN user_branches ub ON ub.user_id = u.id
       WHERE r.code = 'USTADZAH' AND u.is_active AND ub.start_date <= CURRENT_DATE AND (ub.end_date IS NULL OR ub.end_date >= CURRENT_DATE)
         AND ($1::int[] IS NULL OR ub.branch_id = ANY($1))`, [ids]);
    const perBranch = await this.db.many(
      `SELECT b.id AS "branchId", b.name AS "branchName", s.status, COUNT(*)::int AS n FROM students s JOIN branches b ON b.id = s.branch_id
       WHERE ($1::int[] IS NULL OR s.branch_id = ANY($1)) GROUP BY b.id, b.name, s.status`, [ids]);
    const perClass = await this.db.many(
      `SELECT c.id AS "classId", c.name AS "className", b.name AS "branchName", COUNT(*)::int AS n FROM students s JOIN classes c ON c.id = s.class_id JOIN branches b ON b.id = s.branch_id
       WHERE s.status = 'AKTIF' AND ($1::int[] IS NULL OR s.branch_id = ANY($1)) GROUP BY c.id, c.name, b.name ORDER BY c.id`, [ids]);
    const p = await this.db.one(
      `SELECT COUNT(*)::int AS n FROM requests r JOIN students s ON s.id = r.student_id WHERE r.state = 'MENUNGGU' AND ($1::int[] IS NULL OR s.branch_id = ANY($1))`, [ids]);
    return {
      month: ym,
      santri: { total: st!.aktif + st!.cuti + st!.indent, aktif: st!.aktif, cuti: st!.cuti, indent: st!.indent, keluar: st!.keluar, keluarBulanIni: k!.n, putra: st!.putra, putri: st!.putri },
      ustadzahAktif: u!.n, perBranch, perClass, pendingRequests: p!.n, tindakan: await this.tindakan(user, ids),
      keuangan: user.perms.includes('spp.lihat') ? await this.billing.dashboard(ids) : null,
      finance: await this.finance(user, branchId),
      hafalan: { perClass: await this.hafalan.dashboard(ids), top: await this.hafalan.topProgress(ids), belumInputPekanIni: await this.todoHafalan(ids) },
    };
  }
  /** "Perlu tindakan": pengajuan (maks. 3 per jenis) & bukti bayar (maks. 3) yang menunggu + jumlahnya; tanpa nominal/kontak, sesuai izin & scope cabang */
  private async tindakan(user: AuthUser, ids: number[] | null) {
    const canReq = user.perms.includes('pengajuan.lihat'), canPay = user.perms.includes('bayar.lihat');
    const requests = canReq ? await this.db.many(
      `SELECT * FROM (SELECT r.id, r.type, s.id AS "studentId", s.full_name AS "studentName", b.name AS "branchName", tb.name AS "targetBranch",
              ROW_NUMBER() OVER (PARTITION BY r.type ORDER BY r.created_at) AS rn
       FROM requests r JOIN students s ON s.id = r.student_id JOIN branches b ON b.id = COALESCE(r.from_branch_id, s.branch_id)
       LEFT JOIN branches tb ON tb.id = r.target_branch_id
       WHERE r.state = 'MENUNGGU' AND ($1::int[] IS NULL OR s.branch_id = ANY($1))) x WHERE rn <= 3`, [ids]) : [];
    const rc = canReq ? await this.db.one(
      `SELECT COUNT(*) FILTER (WHERE r.type = 'MUTASI')::int AS mutasi, COUNT(*) FILTER (WHERE r.type = 'KELUAR')::int AS keluar
       FROM requests r JOIN students s ON s.id = r.student_id WHERE r.state = 'MENUNGGU' AND ($1::int[] IS NULL OR s.branch_id = ANY($1))`, [ids]) : null;
    const payScope = `p.state = 'MENUNGGU' AND ($1::int[] IS NULL OR EXISTS (SELECT 1 FROM payment_allocations a JOIN invoices i ON i.id = a.invoice_id WHERE a.payment_id = p.id AND i.branch_id = ANY($1)))`;
    const payments = canPay ? await this.db.many(
      `SELECT p.id, f.father_name AS "fatherName",
              (SELECT string_agg(DISTINCT i.label, ', ') FROM payment_allocations a JOIN invoices i ON i.id = a.invoice_id WHERE a.payment_id = p.id) AS items
       FROM payments p JOIN families f ON f.id = p.family_id WHERE ${payScope} ORDER BY p.created_at LIMIT 3`, [ids]) : [];
    const pc = canPay ? await this.db.one(`SELECT COUNT(*)::int AS n FROM payments p WHERE ${payScope}`, [ids]) : null;
    return { requests, payments, count: { mutasi: rc?.mutasi ?? null, keluar: rc?.keluar ?? null, bukti: pc?.n ?? null } };
  }
  /** Santri aktif yang belum diinput hafalannya pekan ini */
  /**
   * Kotak "Keuangan" Beranda: tiga tab sesuai pembukuan terpisah (SPP · Pendaftaran · Kas).
   * Angka diambil dari service menu masing-masing (satu sumber kebenaran); tab tanpa izin lihat = null.
   * Tanpa label subsidi, kontak, atau nominal per keluarga.
   */
  private async finance(user: AuthUser, branchId?: number) {
    const has = (p: string) => user.perms.includes(p);
    const b = branchId ? Number(branchId) : undefined;
    const [spp, reg, kas] = await Promise.all([
      has('spp.lihat') ? this.billing.sppSummary(user, undefined, b) : null,
      has('pendaftaran.lihat') ? this.reg.list(user, b) : null,
      has('kas.lihat') ? this.kas.overview(user, undefined, b) : null,
    ]);
    if (!spp && !reg && !kas) return null;
    const today = todayWIB(), week = addDays(today, 7);
    let pendaftaran: Record<string, unknown> | null = null;
    if (reg) {
      const s = reg.summary;
      const soon = reg.rows.flatMap((r) => r.installments).filter((i) => ['BELUM', 'TERJADWAL'].includes(i.status) && i.dueDate && String(i.dueDate).slice(0, 10) >= today && String(i.dueDate).slice(0, 10) <= week);
      const late = reg.rows.filter((r) => r.status === 'TERLAMBAT').map((r) => {
        const due = r.installments.filter((i) => i.status === 'TUNGGAKAN').map((i) => String(i.dueDate ?? '').slice(0, 10)).filter(Boolean).sort()[0];
        return { name: r.nickname || r.fullName, days: due ? Math.max(0, Math.round((Date.parse(today) - Date.parse(due)) / 86400000)) : 0 };
      }).sort((x, y) => y.days - x.days);
      pendaftaran = {
        santri: s.total, target: s.target, terkumpul: s.terkumpul, menunggu: s.diperiksa, belum: Math.max(0, s.target - s.terkumpul - s.diperiksa),
        lunas: s.lunas, cicilan: s.cicilan, belumBayar: s.belumBayar, buktiDiperiksa: s.menunggu,
        jatuhTempo: { n: soon.length, amount: soon.reduce((a, i) => a + i.amount, 0) },
        terlambat: { n: late.length, first: late[0] ?? null },
      };
    }
    return {
      label: monthLabel(monthStart()),
      spp: spp && {
        tagihan: spp.money.tagihan, terbayar: spp.money.terbayar, menunggu: spp.money.menunggu,
        belum: Math.max(0, spp.money.tagihan - spp.money.terbayar - spp.money.menunggu),
        tunggakan: spp.money.tunggakan, keluargaTunggakan: spp.money.keluargaTunggakan, lunas: spp.counts.LUNAS, total: spp.total,
      },
      pendaftaran,
      kas: kas && {
        masuk: kas.summary.masuk, keluar: kas.summary.keluar, selisih: kas.summary.selisih,
        menunggu: kas.summary.menunggu, menungguNominal: kas.summary.menungguNominal, belumDibayar: kas.summary.belumDibayar,
        keluarTerbesar: kas.categories.keluar.slice(0, 3),
      },
    };
  }
  private async todoHafalan(ids: number[] | null) {
    const r = await this.db.one(
      `SELECT COUNT(*)::int AS n FROM students s WHERE s.status = 'AKTIF' AND ($1::int[] IS NULL OR s.branch_id = ANY($1))
         AND NOT EXISTS (SELECT 1 FROM memorization_records m WHERE m.student_id = s.id AND m.week_start = $2)`, [ids, weekStart()]);
    return r!.n;
  }
}

@Controller('dashboard')
export class DashboardController {
  constructor(private s: DashboardService) {}
  @Get() @Perm('dashboard.lihat') get(@CurrentUser() u: AuthUser, @Query('branchId') b?: number, @Query('month') m?: string) { return this.s.summary(u, b, m); }
}

@Module({ imports: [BillingModule, HafalanModule, RegistrationModule, KasModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
