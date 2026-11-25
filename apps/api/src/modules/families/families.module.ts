import { Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { Db } from '../../db/db.module';
import { CurrentUser, Perm } from '../../common/auth';
import type { AuthUser } from '../../common/auth';
import { AuditService } from '../../common/audit.service';
import { FAMILY_SENSITIVE, canSeeSensitive, mask } from '../../common/mask';

export const PHONE_RULE = /^(\+62|62|0)8[0-9]{7,12}$/;
export const normPhone = (p: string) => p.replace(/[\s-]/g, '').replace(/^(\+62|62)/, '0');
/**
 * Label keluarga ("Kel. …") untuk SQL: nama ayah, lalu nama ibu. Data hasil impor boleh tanpa nama orang tua
 * (migrasi 015), jadi jangan menampilkan f.father_name mentah sebagai label.
 */
export const FAMILY_LABEL = (f = 'f') =>
  `CASE WHEN ${f}.id IS NOT NULL THEN COALESCE(NULLIF(${f}.father_name, ''), NULLIF(${f}.mother_name, ''), '(nama wali belum diisi)') END`; // LEFT JOIN tanpa keluarga tetap NULL
const COLS = `id, father_name AS "fatherName", mother_name AS "motherName", guardian_name AS "guardianName", guardian_relation AS "guardianRelation",
  wa_phone AS "waPhone", backup_phone AS "backupPhone", address, father_job AS "fatherJob", mother_job AS "motherJob", created_at AS "createdAt"`;
// scope: keluarga punya minimal satu santri di cabang pengguna ($1 = int[] atau NULL = semua)
const SCOPE = `($1::int[] IS NULL OR EXISTS (SELECT 1 FROM students s WHERE s.family_id = f.id AND s.branch_id = ANY($1)))`;

export class FamilyDto {
  @IsString() @MinLength(2) fatherName: string;
  @IsString() @MinLength(2) motherName: string;
  @IsOptional() @IsString() guardianName?: string;
  @IsOptional() @IsString() guardianRelation?: string;
  @IsString() @Matches(PHONE_RULE, { message: 'Nomor WA harus diawali 08 atau +62' }) waPhone: string;
  @IsOptional() @IsString() backupPhone?: string;
  @IsString() @MinLength(5) address: string;
  @IsOptional() @IsString() fatherJob?: string;
  @IsOptional() @IsString() motherJob?: string;
}
/** Keluarga dari impor data lama: nama ayah/ibu, no. WA, dan alamat boleh kosong (form tetap memakai FamilyDto). */
export type FamilyInput = Omit<FamilyDto, 'fatherName' | 'motherName' | 'waPhone' | 'address'> & { fatherName?: string; motherName?: string; waPhone?: string; address?: string };

@Injectable()
export class FamiliesService {
  constructor(private db: Db, private audit: AuditService) {}

  async list(user: AuthUser, q?: string) {
    const rows = await this.db.many(
      `SELECT ${COLS}, (SELECT COUNT(*) FROM students s WHERE s.family_id = f.id)::int AS "studentCount",
              (SELECT COALESCE(json_agg(json_build_object('id', s.id, 'name', COALESCE(s.nickname, split_part(s.full_name, ' ', 1)), 'status', s.status, 'branch', b.name) ORDER BY s.birth_date), '[]'::json)
                 FROM students s JOIN branches b ON b.id = s.branch_id WHERE s.family_id = f.id AND ($1::int[] IS NULL OR s.branch_id = ANY($1))) AS kids
       FROM families f
       WHERE ${SCOPE} AND ($2::text IS NULL OR f.father_name ILIKE $2 OR f.mother_name ILIKE $2 OR f.wa_phone ILIKE $3)
       ORDER BY f.father_name LIMIT 200`, [user.branchIds, q ? `%${q}%` : null, q ? `%${normPhone(q)}%` : null]);
    return rows.map((r) => mask(user, r, FAMILY_SENSITIVE));
  }

  async get(user: AuthUser, id: number) {
    const f = await this.db.one(`SELECT ${COLS} FROM families f WHERE f.id = $2 AND ${SCOPE}`, [user.branchIds, id]);
    if (!f) throw new NotFoundException('Keluarga tidak ditemukan');
    const kids = await this.db.many(
      `SELECT s.id, s.nis, s.full_name AS "fullName", s.status, s.branch_id AS "branchId", b.name AS "branchName", s.subsidy_id AS "subsidyId", s.subsidy_label AS "subsidyLabel", s.spp_rate AS "sppRate"
       FROM students s JOIN branches b ON b.id = s.branch_id WHERE s.family_id = $2 AND ($1::int[] IS NULL OR s.branch_id = ANY($1)) ORDER BY s.birth_date`, [user.branchIds, id]);
    // label & tarif subsidi rahasia: hanya PJ/ustadzah
    if (!canSeeSensitive(user)) for (const k of kids) { delete k.subsidyId; delete k.subsidyLabel; delete k.sppRate; }
    return { ...mask(user, f, FAMILY_SENSITIVE), students: kids };
  }

  /** Cek no. WA sebelum membuat keluarga baru. Di luar scope: hanya memberi tanda, detail tidak dibuka. */
  async lookup(user: AuthUser, phone: string, client?: any) {
    const f = await this.db.one(`SELECT ${COLS} FROM families f WHERE wa_phone = $1`, [normPhone(phone)], client);
    if (!f) return { found: false };
    const inScope = !user.branchIds || !!(await this.db.one('SELECT 1 FROM students WHERE family_id = $1 AND branch_id = ANY($2)', [f.id, user.branchIds], client));
    if (!inScope) return { found: true, inScope: false, message: 'Nomor WA ini sudah terdaftar di cabang lain. Hubungi PJ RTA untuk menautkan keluarga.' };
    const kids = await this.db.many(
      `SELECT s.id, s.full_name AS "fullName", s.status, c.name AS "className" FROM students s JOIN classes c ON c.id = s.class_id
       WHERE s.family_id = $1 AND ($2::int[] IS NULL OR s.branch_id = ANY($2)) ORDER BY s.birth_date`, [f.id, user.branchIds], client);
    return { found: true, inScope: true, family: { ...mask(user, f, FAMILY_SENSITIVE), students: kids } };
  }

  async create(user: AuthUser, dto: FamilyInput, client?: any) {
    const f = await this.db.one(
      `INSERT INTO families(father_name, mother_name, guardian_name, guardian_relation, wa_phone, backup_phone, address, father_job, mother_job)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${COLS}`,
      [dto.fatherName || null, dto.motherName || null, dto.guardianName ?? null, dto.guardianRelation ?? null, dto.waPhone ? normPhone(dto.waPhone) : null,
        dto.backupPhone ? normPhone(dto.backupPhone) : null, dto.address || null, dto.fatherJob ?? null, dto.motherJob ?? null], client);
    await this.audit.log(user.id, 'create', 'family', f!.id, null, { fatherName: f!.fatherName, motherName: f!.motherName }, client);
    return f!;
  }

  async update(user: AuthUser, id: number, dto: Partial<FamilyDto>) {
    const old = await this.db.one(`SELECT ${COLS} FROM families f WHERE f.id = $2 AND ${SCOPE}`, [user.branchIds, id]);
    if (!old) throw new NotFoundException('Keluarga tidak ditemukan');
    const n = { ...old, ...dto };
    if (dto.waPhone) n.waPhone = normPhone(dto.waPhone);
    if (dto.backupPhone) n.backupPhone = normPhone(dto.backupPhone);
    await this.db.exec(
      `UPDATE families SET father_name=$2, mother_name=$3, guardian_name=$4, guardian_relation=$5, wa_phone=$6, backup_phone=$7, address=$8, father_job=$9, mother_job=$10 WHERE id=$1`,
      [id, n.fatherName, n.motherName, n.guardianName ?? null, n.guardianRelation ?? null, n.waPhone, n.backupPhone ?? null, n.address, n.fatherJob ?? null, n.motherJob ?? null]);
    await this.audit.log(user.id, 'update', 'family', id, old, dto);
    return { ok: true };
  }
}

@Controller('families')
export class FamiliesController {
  constructor(private s: FamiliesService) {}
  @Get() @Perm('wali.lihat') list(@CurrentUser() u: AuthUser, @Query('q') q?: string) { return this.s.list(u, q); }
  @Get('lookup') @Perm('wali.lihat') lookup(@CurrentUser() u: AuthUser, @Query('phone') phone: string) { return this.s.lookup(u, phone ?? ''); }
  @Get(':id') @Perm('wali.lihat') get(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.s.get(u, id); }
  @Post() @Perm('wali.input') create(@CurrentUser() u: AuthUser, @Body() dto: FamilyDto) { return this.s.create(u, dto); }
  @Patch(':id') @Perm('wali.edit') update(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: Partial<FamilyDto>) { return this.s.update(u, id, dto); }
}

@Module({ controllers: [FamiliesController], providers: [FamiliesService, AuditService], exports: [FamiliesService] })
export class FamiliesModule {}
