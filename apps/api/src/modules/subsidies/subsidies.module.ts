import { BadRequestException, Body, Controller, Get, Global, Injectable, Module, NotFoundException, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import type { PoolClient } from 'pg';
import { Db } from '../../db/db.module';
import { CurrentUser, Perm } from '../../common/auth';
import type { AuthUser } from '../../common/auth';
import { AuditService } from '../../common/audit.service';
import { todayWIB } from '../../common/time';

const MAX_FEE = 10_000_000;

class RateDto {
  @IsInt() branchId: number;
  @IsBoolean() available: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_FEE) amount?: number;   // wajib untuk TARIF
  @IsOptional() @IsString() @MaxLength(80) note?: string;
}
class SubsidyDto {
  @IsString() @Length(2, 40, { message: 'Nama kategori 2–40 karakter' }) name: string;
  @IsIn(['TARIF', 'DISKON']) kind: 'TARIF' | 'DISKON';
  @IsOptional() @IsInt() @Min(1) @Max(100) percent?: number;       // wajib untuk DISKON
  @IsOptional() @IsBoolean() isSibling?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsArray() @ArrayUnique((r: RateDto) => r.branchId) @ValidateNested({ each: true }) @Type(() => RateDto) rates: RateDto[];
  @IsOptional() @IsBoolean() applyToStudents?: boolean; // ikut ubah tarif santri yang sudah memakai kategori ini
}

/** Tarif SPP hasil subsidi: TARIF = nominal cabang, DISKON = persen dari tarif standar cabang. */
const rateSql = `CASE WHEN x.kind = 'DISKON' THEN ROUND(b.spp_standard * (100 - x.percent) / 100.0)::int ELSE r.amount END`;
export type SubsidyChange = { studentId: number; old: any; new: any; action: string };

@Injectable()
export class SubsidiesService {
  constructor(private db: Db, private audit: AuditService) {}

  async list() {
    const xs = await this.db.many('SELECT id, name, kind, percent, is_sibling AS "isSibling", is_active AS "isActive" FROM subsidies ORDER BY is_active DESC, id');
    const rs = await this.db.many(`SELECT r.subsidy_id, r.branch_id AS "branchId", r.available, r.note, ${rateSql} AS amount
      FROM subsidy_rates r JOIN subsidies x ON x.id = r.subsidy_id JOIN branches b ON b.id = r.branch_id`);
    const hs = await this.db.many(`SELECT subsidy_id, branch_id AS "branchId", COUNT(*)::int AS n FROM students WHERE subsidy_id IS NOT NULL AND status <> 'KELUAR' GROUP BY 1, 2`);
    return xs.map((x) => ({ ...x,
      rates: rs.filter((r) => r.subsidy_id === x.id).map(({ subsidy_id, ...r }) => r),
      holders: hs.filter((h) => h.subsidy_id === x.id).map(({ subsidy_id, ...h }) => h) }));
  }

  /** Validasi & hitung tarif santri untuk kategori di cabang tertentu (aturan 1, 3, 6). */
  async resolve(subsidyId: number, branchId: number, ctx: { familyId?: number; studentId?: number; skipSibling?: boolean } = {}, c?: PoolClient) {
    const r = await this.db.one(`SELECT x.name, x.is_sibling, x.is_active, r.available, ${rateSql} AS amount
      FROM subsidies x JOIN branches b ON b.id = $2 LEFT JOIN subsidy_rates r ON r.subsidy_id = x.id AND r.branch_id = b.id WHERE x.id = $1`, [subsidyId, branchId], c);
    if (!r || !r.is_active) throw new BadRequestException('Kategori subsidi tidak ditemukan atau sudah nonaktif');
    if (!r.available || r.amount == null) throw new BadRequestException(`Subsidi "${r.name}" tidak berlaku di cabang ini`);
    if (r.is_sibling && !ctx.skipSibling) { // skipSibling: impor data apa adanya
      const sib = ctx.familyId && await this.db.one(`SELECT 1 FROM students WHERE family_id = $1 AND status = 'AKTIF' AND ($2::int IS NULL OR id <> $2) LIMIT 1`, [ctx.familyId, ctx.studentId ?? null], c);
      if (!sib) throw new BadRequestException(`"${r.name}" butuh minimal satu saudara berstatus Aktif dalam keluarga yang sama`);
    }
    return { name: r.name as string, amount: r.amount as number, since: todayWIB() };
  }

  async create(user: AuthUser, dto: SubsidyDto) {
    this.check(dto);
    if (await this.db.one('SELECT 1 FROM subsidies WHERE lower(name) = lower($1)', [dto.name.trim()])) throw new BadRequestException('Nama kategori sudah dipakai');
    const id = await this.db.tx(async (c) => {
      const x = (await c.query('INSERT INTO subsidies(name, kind, percent, is_sibling) VALUES ($1,$2,$3,$4) RETURNING id', [dto.name.trim(), dto.kind, dto.kind === 'DISKON' ? dto.percent : null, !!dto.isSibling])).rows[0];
      await this.saveRates(c, x.id, dto);
      return x.id as number;
    });
    await this.audit.log(user.id, 'create', 'subsidy', id, null, this.plain(dto));
    return { id };
  }

  async update(user: AuthUser, id: number, dto: SubsidyDto) {
    this.check(dto);
    const old = (await this.list()).find((x) => x.id === id);
    if (!old) throw new NotFoundException('Kategori subsidi tidak ditemukan');
    if (old.kind !== dto.kind && old.holders.length) throw new BadRequestException('Jenis subsidi tidak bisa diganti selama masih dipakai santri');
    if (await this.db.one('SELECT 1 FROM subsidies WHERE lower(name) = lower($1) AND id <> $2', [dto.name.trim(), id])) throw new BadRequestException('Nama kategori sudah dipakai');
    const active = dto.isActive ?? old.isActive;
    // cabang yang dicabut / kategori yang dinonaktifkan tidak boleh masih dipakai santri
    const blocked = old.holders.filter((h: any) => !active || !dto.rates.find((r) => r.branchId === h.branchId)?.available);
    if (blocked.length) {
      const names = await this.db.many('SELECT name FROM branches WHERE id = ANY($1) ORDER BY id', [blocked.map((h: any) => h.branchId)]);
      throw new BadRequestException(`Masih dipakai ${blocked.reduce((a: number, h: any) => a + h.n, 0)} santri di cabang ${names.map((b) => b.name).join(', ')}. Cabut subsidinya di data santri dulu.`);
    }
    const moved = await this.db.tx(async (c) => {
      await c.query('UPDATE subsidies SET name = $2, percent = $3, is_sibling = $4, is_active = $5 WHERE id = $1', [id, dto.name.trim(), dto.kind === 'DISKON' ? dto.percent : null, !!dto.isSibling, active]);
      await this.saveRates(c, id, dto);
      await c.query('UPDATE students SET subsidy_label = $2 WHERE subsidy_id = $1', [id, dto.name.trim()]);
      if (!dto.applyToStudents) return 0;
      return (await c.query(`UPDATE students s SET spp_rate = ${rateSql} FROM subsidies x JOIN subsidy_rates r ON r.subsidy_id = x.id JOIN branches b ON b.id = r.branch_id
        WHERE x.id = $1 AND s.subsidy_id = x.id AND r.branch_id = s.branch_id AND s.status <> 'KELUAR' AND s.spp_rate <> ${rateSql}`, [id])).rowCount ?? 0;
    });
    await this.audit.log(user.id, 'update', 'subsidy', id, { name: old.name, kind: old.kind, percent: old.percent, isSibling: old.isSibling, isActive: old.isActive, rates: old.rates },
      { ...this.plain(dto), isActive: active, santriDiubah: moved });
    return { ok: true, santriDiubah: moved };
  }

  private check(dto: SubsidyDto) {
    if (dto.kind === 'DISKON' && !dto.percent) throw new BadRequestException('Persen diskon wajib diisi (1–100)');
    if (dto.kind === 'TARIF' && dto.rates.some((r) => r.available && r.amount == null)) throw new BadRequestException('Isi tarif pengganti untuk setiap cabang yang tersedia');
    if (!dto.rates.some((r) => r.available)) throw new BadRequestException('Pilih minimal satu cabang');
  }
  private async saveRates(c: PoolClient, id: number, dto: SubsidyDto) {
    for (const r of dto.rates)
      await c.query(`INSERT INTO subsidy_rates(subsidy_id, branch_id, available, amount, note) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (subsidy_id, branch_id) DO UPDATE SET available = EXCLUDED.available, amount = EXCLUDED.amount, note = EXCLUDED.note`,
        [id, r.branchId, r.available, dto.kind === 'TARIF' ? r.amount ?? null : null, r.note?.trim() || null]);
  }
  private plain(dto: SubsidyDto) { const { applyToStudents, ...rest } = dto; return rest; }

  /**
   * Diskon saudara (aturan 4): berlaku selama minimal dua anak pemegangnya berstatus Aktif.
   * Bila kurang dari dua, semua pemegang di keluarga itu kembali ke tarif standar cabangnya (mulai tagihan SPP berikutnya).
   */
  async reconcileFamily(c: PoolClient, familyId: number): Promise<SubsidyChange[]> {
    const holders = (await c.query(`SELECT s.id, s.status, s.spp_rate, s.subsidy_label, b.spp_standard FROM students s JOIN subsidies x ON x.id = s.subsidy_id JOIN branches b ON b.id = s.branch_id
      WHERE s.family_id = $1 AND x.is_sibling`, [familyId])).rows;
    if (!holders.length || holders.filter((h) => h.status === 'AKTIF').length >= 2) return [];
    for (const h of holders) await c.query('UPDATE students SET subsidy_id = NULL, subsidy_label = NULL, subsidy_since = NULL, spp_rate = $2 WHERE id = $1', [h.id, h.spp_standard]);
    return holders.map((h) => ({ studentId: h.id, action: 'subsidi_dicabut_otomatis', old: { subsidyLabel: h.subsidy_label, sppRate: h.spp_rate }, new: { subsidyLabel: null, sppRate: h.spp_standard, alasan: 'Saudara tidak lagi Aktif' } }));
  }

  /** Mutasi: tarif mengikuti cabang tujuan. Subsidi tetap bila berlaku di cabang tujuan, dicabut bila tidak (mis. daycare). */
  async rebranch(c: PoolClient, studentId: number, branchId: number): Promise<SubsidyChange[]> {
    const s = (await c.query('SELECT subsidy_id, subsidy_label, spp_rate FROM students WHERE id = $1', [studentId])).rows[0];
    const std = (await c.query('SELECT spp_standard FROM branches WHERE id = $1', [branchId])).rows[0].spp_standard;
    const r = s.subsidy_id && (await c.query(`SELECT ${rateSql} AS amount, r.available FROM subsidies x JOIN branches b ON b.id = $2 LEFT JOIN subsidy_rates r ON r.subsidy_id = x.id AND r.branch_id = b.id WHERE x.id = $1`, [s.subsidy_id, branchId])).rows[0];
    if (s.subsidy_id && r?.available && r.amount != null) { await c.query('UPDATE students SET spp_rate = $2 WHERE id = $1', [studentId, r.amount]); return []; }
    await c.query('UPDATE students SET spp_rate = $2, subsidy_id = NULL, subsidy_label = CASE WHEN subsidy_id IS NULL THEN subsidy_label END, subsidy_since = NULL WHERE id = $1', [studentId, std]);
    return s.subsidy_id ? [{ studentId, action: 'subsidi_dicabut_otomatis', old: { subsidyLabel: s.subsidy_label, sppRate: s.spp_rate }, new: { subsidyLabel: null, sppRate: std, alasan: 'Tidak berlaku di cabang tujuan' } }] : [];
  }

  /**
   * Diskon saudara untuk kedua anak (aturan 3 & 5): saat santri Aktif dipasangi diskon saudara, saudara Aktif yang masih
   * Reguler (tanpa subsidi, tarif = standar cabangnya) ikut dipasangi, tarif dari cabangnya masing-masing.
   * Saudara bersubsidi lain (mis. Yatim) atau bertarif khusus tidak diubah.
   */
  async pairSiblings(c: PoolClient, studentId: number): Promise<SubsidyChange[]> {
    const s = (await c.query(`SELECT s.family_id, s.subsidy_id FROM students s JOIN subsidies x ON x.id = s.subsidy_id
      WHERE s.id = $1 AND s.status = 'AKTIF' AND x.is_sibling AND x.is_active`, [studentId])).rows[0];
    if (!s) return [];
    const sibs = (await c.query(`SELECT s.id, s.spp_rate, r.available, ${rateSql} AS amount, x.name FROM students s
      JOIN branches b ON b.id = s.branch_id JOIN subsidies x ON x.id = $3 LEFT JOIN subsidy_rates r ON r.subsidy_id = x.id AND r.branch_id = b.id
      WHERE s.family_id = $1 AND s.id <> $2 AND s.status = 'AKTIF' AND s.subsidy_id IS NULL AND s.spp_rate = b.spp_standard`, [s.family_id, studentId, s.subsidy_id])).rows;
    const out: SubsidyChange[] = [];
    for (const x of sibs.filter((y) => y.available && y.amount != null)) {
      await c.query('UPDATE students SET subsidy_id = $2, subsidy_label = $3, subsidy_since = $4, spp_rate = $5 WHERE id = $1', [x.id, s.subsidy_id, x.name, todayWIB(), x.amount]);
      out.push({ studentId: x.id, action: 'subsidi_dipasang_otomatis', old: { subsidyLabel: null, sppRate: x.spp_rate }, new: { subsidyLabel: x.name, sppRate: x.amount, alasan: 'Mengikuti saudara yang dipasangi diskon saudara' } });
    }
    return out;
  }

  async logChanges(actorId: number, changes: SubsidyChange[], client?: PoolClient) {
    for (const ch of changes) await this.audit.log(actorId, ch.action, 'student', ch.studentId, ch.old, ch.new, client);
  }
}

@Controller('subsidies')
export class SubsidiesController {
  constructor(private s: SubsidiesService) {}
  // label kategori subsidi sensitif: hanya pengguna yang boleh memasang subsidi (PJ)
  @Get() @Perm('spp.input') list() { return this.s.list(); }
  @Post() @Perm('pengaturan.edit') create(@CurrentUser() u: AuthUser, @Body() dto: SubsidyDto) { return this.s.create(u, dto); }
  @Patch(':id') @Perm('pengaturan.edit') update(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SubsidyDto) { return this.s.update(u, id, dto); }
}

@Global()
@Module({ controllers: [SubsidiesController], providers: [SubsidiesService, AuditService], exports: [SubsidiesService] })
export class SubsidiesModule {}
