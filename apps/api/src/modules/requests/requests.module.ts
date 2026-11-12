import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { Db } from '../../db/db.module';
import { CurrentUser, Perm } from '../../common/auth';
import type { AuthUser } from '../../common/auth';
import { AuditService } from '../../common/audit.service';
import { academicYearStart } from '../../common/time';
import { SettingsService } from '../settings/settings.module';
import { SubsidiesService } from '../subsidies/subsidies.module';
import type { SubsidyChange } from '../subsidies/subsidies.module';

class DecideDto { @IsOptional() @IsString() @MinLength(2) note?: string; }

@Injectable()
export class RequestsService {
  constructor(private db: Db, private audit: AuditService, private settings: SettingsService, private subsidies: SubsidiesService) {}

  list(user: AuthUser, state?: string) {
    return this.db.many(
      `SELECT r.id, r.type, r.state, r.effective_date AS "effectiveDate", r.reason, r.note, r.decision_note AS "decisionNote", r.created_at AS "createdAt", r.decided_at AS "decidedAt",
              s.id AS "studentId", s.full_name AS "studentName", s.nis, b.name AS "branchName", c.name AS "className",
              tb.name AS "targetBranch", tc.name AS "targetClass", u.name AS "requestedBy"
       FROM requests r JOIN students s ON s.id = r.student_id
       JOIN branches b ON b.id = COALESCE(r.from_branch_id, s.branch_id) JOIN classes c ON c.id = COALESCE(r.from_class_id, s.class_id)
       LEFT JOIN branches tb ON tb.id = r.target_branch_id LEFT JOIN classes tc ON tc.id = r.target_class_id JOIN users u ON u.id = r.requested_by
       WHERE ($1::text IS NULL OR r.state = $1) AND ($2::int[] IS NULL OR s.branch_id = ANY($2)) ORDER BY r.created_at DESC`, [state || null, user.branchIds]);
  }

  private async pending(id: number) {
    const r = await this.db.one('SELECT * FROM requests WHERE id = $1', [id]);
    if (!r) throw new NotFoundException('Pengajuan tidak ditemukan');
    if (r.state !== 'MENUNGGU') throw new BadRequestException('Pengajuan sudah diputuskan');
    return r;
  }

  /** Setujui: KELUAR → status Keluar (arsip). MUTASI → cabang & kelas baru, tarif cabang tujuan, riwayat ikut (tabel sama). */
  async approve(user: AuthUser, id: number, note?: string) {
    const r = await this.pending(id);
    const s = await this.db.one('SELECT id, status, family_id FROM students WHERE id = $1', [r.student_id]);
    const cfg = await this.settings.get();
    const changes = await this.db.tx(async (c) => {
      const out: SubsidyChange[] = [];
      if (r.type === 'KELUAR') {
        await c.query(`UPDATE students SET status = 'KELUAR', archived_at = now() WHERE id = $1`, [s!.id]);
        await c.query('INSERT INTO status_history(student_id, from_status, to_status, effective_date, reason, note, actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [s!.id, s!.status, 'KELUAR', r.effective_date, r.reason, note ?? r.note, user.id]);
      } else {
        const tb = (await c.query('SELECT name, spp_standard FROM branches WHERE id = $1', [r.target_branch_id])).rows[0];
        await c.query('UPDATE students SET branch_id = $2, class_id = $3 WHERE id = $1', [s!.id, r.target_branch_id, r.target_class_id]);
        out.push(...await this.subsidies.rebranch(c, s!.id, r.target_branch_id)); // tarif cabang tujuan; subsidi ikut bila berlaku di sana
        await c.query('INSERT INTO student_placements(student_id, branch_id, class_id, effective_date, note) VALUES ($1,$2,$3,$4,$5)', [s!.id, r.target_branch_id, r.target_class_id, r.effective_date, `Mutasi: ${r.reason}`]);
        await c.query('INSERT INTO status_history(student_id, from_status, to_status, effective_date, reason, note, actor_id) VALUES ($1,$2,$2,$3,$4,$5,$6)',
          [s!.id, s!.status, r.effective_date, r.reason, `Mutasi ke ${tb.name}`, user.id]);
        // Biaya pindah = daftar ulang tahun berjalan; indeks unik + cek ±6 bulan mencegah tagihan ganda dalam satu tahun pembelajaran
        const ay = academicYearStart(cfg.academicYearStartMonth);
        const fam = (await c.query('SELECT family_id FROM students WHERE id = $1', [s!.id])).rows[0];
        await c.query(`INSERT INTO invoices(student_id, family_id, branch_id, type, period, label, amount, note)
           SELECT $1,$2,$3,'DAFTAR_ULANG',$4::date,$5,$6,'Biaya pindah cabang'
           WHERE NOT EXISTS (SELECT 1 FROM invoices x WHERE x.student_id = $1 AND x.type = 'DAFTAR_ULANG' AND x.voided_at IS NULL AND x.period > $4::date - interval '6 months' AND x.period < $4::date + interval '6 months')
           ON CONFLICT (student_id, type, period) WHERE voided_at IS NULL AND type <> 'BARANG' DO NOTHING`,
          [s!.id, fam.family_id, r.target_branch_id, ay, `Daftar ulang ${ay.slice(0, 4)}/${Number(ay.slice(0, 4)) + 1}`, cfg.reregistrationFee]);
      }
      await c.query(`UPDATE requests SET state = 'DISETUJUI', decided_by = $2, decision_note = $3, decided_at = now() WHERE id = $1`, [id, user.id, note ?? null]);
      out.push(...await this.subsidies.reconcileFamily(c, s!.family_id));
      return out;
    });
    await this.audit.log(user.id, 'setujui', 'request', id, { state: 'MENUNGGU' }, { state: 'DISETUJUI', note });
    await this.subsidies.logChanges(user.id, changes);
    return { ok: true };
  }

  /** Pengaju (atau PJ) menarik pengajuan yang masih menunggu */
  async withdraw(user: AuthUser, id: number) {
    const r = await this.pending(id);
    if (r.requested_by !== user.id && !user.perms.includes('pengajuan.setujui')) throw new BadRequestException('Hanya pengaju yang bisa menarik pengajuan ini');
    await this.db.exec(`UPDATE requests SET state = 'DITARIK', decided_by = $2, decided_at = now() WHERE id = $1`, [id, user.id]);
    await this.audit.log(user.id, 'tarik', 'request', id, { state: 'MENUNGGU' }, { state: 'DITARIK' });
    return { ok: true };
  }

  /** Detail untuk layar tinjau PJ: dari/ke, tarif, cek tunggakan & ketersediaan kelas */
  async detail(user: AuthUser, id: number) {
    const r = await this.db.one(
      `SELECT r.*, s.full_name, s.nis, s.spp_rate, s.status AS student_status, s.family_id, b.name AS from_branch, c.name AS from_class,
              tb.name AS to_branch, tb.spp_standard AS to_spp, tc.name AS to_class, u.name AS requested_by_name, f.father_name
       FROM requests r JOIN students s ON s.id = r.student_id JOIN branches b ON b.id = COALESCE(r.from_branch_id, s.branch_id) JOIN classes c ON c.id = COALESCE(r.from_class_id, s.class_id)
       JOIN families f ON f.id = s.family_id JOIN users u ON u.id = r.requested_by
       LEFT JOIN branches tb ON tb.id = r.target_branch_id LEFT JOIN classes tc ON tc.id = r.target_class_id
       WHERE r.id = $1 AND ($2::int[] IS NULL OR s.branch_id = ANY($2))`, [id, user.branchIds]);
    if (!r) throw new NotFoundException('Pengajuan tidak ditemukan');
    const hafalan = await this.db.one('SELECT percent::float AS percent FROM memorization_records WHERE student_id = $1 ORDER BY week_start DESC, id DESC LIMIT 1', [r.student_id]);
    const debt = await this.db.one(
      `SELECT COALESCE(SUM(i.amount - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE a.invoice_id = i.id AND p.state = 'TERVERIFIKASI'), 0)), 0)::int AS sisa
       FROM invoices i WHERE i.student_id = $1 AND i.voided_at IS NULL AND i.period < date_trunc('month', now())::date`, [r.student_id]);
    return { id: r.id, type: r.type, state: r.state, effectiveDate: r.effective_date, reason: r.reason, note: r.note, decisionNote: r.decision_note, createdAt: r.created_at,
      requestedBy: r.requested_by_name, student: { id: r.student_id, name: r.full_name, nis: r.nis, wali: r.father_name, hafalan: hafalan?.percent ?? null },
      from: { branch: r.from_branch, className: r.from_class, spp: r.spp_rate }, to: r.type === 'MUTASI' ? { branch: r.to_branch, className: r.to_class, spp: r.to_spp } : null,
      checks: { tunggakan: debt?.sisa ?? 0, kelasTersedia: r.type !== 'MUTASI' || !!r.to_class }, moveFee: (await this.settings.get()).reregistrationFee };
  }

  async reject(user: AuthUser, id: number, note?: string) {
    if (!note) throw new BadRequestException('Catatan penolakan wajib diisi');
    await this.pending(id);
    await this.db.exec(`UPDATE requests SET state = 'DITOLAK', decided_by = $2, decision_note = $3, decided_at = now() WHERE id = $1`, [id, user.id, note]);
    await this.audit.log(user.id, 'tolak', 'request', id, { state: 'MENUNGGU' }, { state: 'DITOLAK', note });
    return { ok: true };
  }
}

@Controller('requests')
export class RequestsController {
  constructor(private s: RequestsService) {}
  @Get() @Perm('pengajuan.lihat') list(@CurrentUser() u: AuthUser, @Query('state') state?: string) { return this.s.list(u, state); }
  @Get(':id') @Perm('pengajuan.lihat') detail(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.s.detail(u, id); }
  @Post(':id/withdraw') @Perm('pengajuan.input') withdraw(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.s.withdraw(u, id); }
  @Post(':id/approve') @Perm('pengajuan.setujui') approve(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: DecideDto) { return this.s.approve(u, id, dto.note); }
  @Post(':id/reject') @Perm('pengajuan.setujui') reject(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: DecideDto) { return this.s.reject(u, id, dto.note); }
}

@Module({ controllers: [RequestsController], providers: [RequestsService, AuditService] })
export class RequestsModule {}
