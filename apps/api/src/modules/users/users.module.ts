import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, Logger, Module, NotFoundException, OnModuleDestroy, OnModuleInit, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ArrayUnique, IsArray, IsBoolean, IsDateString, IsEmail, IsInt, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { randomBytes } from 'crypto';
import { Db } from '../../db/db.module';
import { CurrentUser, Perm } from '../../common/auth';
import type { AuthUser } from '../../common/auth';
import { AuditService } from '../../common/audit.service';
import { hashPassword } from '../../common/password';

const PASSWORD_RULE = /(?=.*[A-Za-z])(?=.*\d)/;
class CreateUserDto {
  @IsString() @MinLength(2) name: string;
  @IsEmail() email: string;
  @IsOptional() @IsString() phone?: string;
  @IsString() @MinLength(8, { message: 'Password minimal 8 karakter' }) @Matches(PASSWORD_RULE, { message: 'Password harus memuat huruf dan angka' }) password: string;
  @IsString() roleCode: string;
  @IsOptional() @IsInt() familyId?: number; // wajib untuk role WALI
  @IsOptional() @IsArray() @ArrayUnique() @IsInt({ each: true }) branchIds?: number[]; // wajib untuk role USTADZAH
}
class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() roleCode?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class DeleteDto { @IsString() @MinLength(3, { message: 'Alasan hapus wajib diisi' }) reason: string; }
class AssignDto { @IsInt() branchId: number; @IsDateString() startDate: string; @IsOptional() @IsDateString() endDate?: string; }
const tempPassword = () => 'Rta' + randomBytes(4).toString('hex') + '1';
const DELETE_GRACE_DAYS = 30;
const PENDING_DELETE = 'Akun ini sedang dalam daftar hapus. Batalkan penghapusan dulu.';

@Injectable()
export class UsersService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Users');
  private timer: any;
  constructor(private db: Db, private audit: AuditService) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === 'true') return;
    const run = () => this.purgeDue().catch((e) => this.log.error(e));
    setTimeout(run, 2000);
    this.timer = setInterval(run, 60 * 60_000); // tiap jam; hapus permanen akun yang masa tunggunya habis
  }
  onModuleDestroy() { clearInterval(this.timer); }

  async list(q?: string, roleCode?: string) {
    const params: any[] = []; const conds: string[] = ['u.deleted_at IS NULL'];
    if (roleCode) { params.push(roleCode); conds.push(`r.code = $${params.length}`); }
    if (q) { params.push(`%${q}%`); conds.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
    const sql = `SELECT u.id, u.name, u.email, u.phone, u.is_active AS "isActive", u.locked_until AS "lockedUntil",
                        u.must_change_password AS "mustChangePassword", r.code AS "roleCode", r.name AS "roleName", u.created_at AS "createdAt",
                        u.family_id AS "familyId", f.father_name AS "familyName", to_char(u.delete_after, 'YYYY-MM-DD') AS "deleteAfter", u.delete_reason AS "deleteReason"
                 FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN families f ON f.id = u.family_id WHERE ${conds.join(' AND ')} ORDER BY u.name`;
    const rows = await this.db.many(sql, params);
    const ubs = await this.db.many(
      `SELECT ub.id, ub.user_id AS "userId", ub.branch_id AS "branchId", b.name AS "branchName", ub.start_date AS "startDate", ub.end_date AS "endDate"
       FROM user_branches ub JOIN branches b ON b.id = ub.branch_id ORDER BY ub.start_date`);
    return rows.map((r) => ({ ...r, branches: ubs.filter((b) => b.userId === r.id) }));
  }

  private async roleId(code: string) {
    const r = await this.db.one('SELECT id FROM roles WHERE code = $1', [code]);
    if (!r) throw new BadRequestException('Role tidak dikenal');
    return r.id;
  }

  async create(actor: AuthUser, dto: CreateUserDto) {
    const email = dto.email.toLowerCase();
    if (await this.db.one('SELECT 1 FROM users WHERE email = $1', [email])) throw new BadRequestException('Email sudah dipakai akun lain');
    // akun wali hanya melihat data satu keluarga
    const familyId = dto.roleCode === 'WALI' ? dto.familyId ?? null : null;
    if (dto.roleCode === 'WALI' && !(familyId && (await this.db.one('SELECT 1 FROM families WHERE id = $1', [familyId])))) throw new BadRequestException('Pilih keluarga untuk akun wali');
    // ustadzah hanya melihat santri cabang yang ditugaskan: tanpa cabang, datanya kosong
    const branchIds = dto.roleCode === 'USTADZAH' ? dto.branchIds ?? [] : [];
    if (dto.roleCode === 'USTADZAH') {
      if (!branchIds.length) throw new BadRequestException('Pilih minimal satu cabang untuk akun ustadzah');
      const n = await this.db.one('SELECT COUNT(*)::int AS n FROM branches WHERE is_active AND id = ANY($1)', [branchIds]);
      if (n!.n !== branchIds.length) throw new BadRequestException('Cabang tidak dikenal');
    }
    const roleId = await this.roleId(dto.roleCode);
    const hash = await hashPassword(dto.password);
    const id = await this.db.tx(async (c) => {
      const u = await this.db.one('INSERT INTO users(name, email, phone, password_hash, role_id, family_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [dto.name, email, dto.phone ?? null, hash, roleId, familyId], c);
      // CURRENT_DATE, sama dengan pengecekan penugasan aktif di AuthService, agar akses langsung berlaku
      if (branchIds.length) await this.db.exec('INSERT INTO user_branches(user_id, branch_id, start_date) SELECT $1, unnest($2::int[]), CURRENT_DATE', [u!.id, branchIds], c);
      return u!.id as number;
    });
    await this.audit.log(actor.id, 'create', 'user', id, null, { name: dto.name, email, role: dto.roleCode, familyId, branchIds });
    return { id };
  }

  /** Akun yang masih bisa dikelola: belum dihapus permanen dan tidak sedang di daftar hapus. */
  private async editable(id: number) {
    const u = await this.db.one('SELECT id, name, phone, is_active, role_id, family_id, delete_after FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!u) throw new NotFoundException('Akun tidak ditemukan');
    if (u.delete_after) throw new BadRequestException(PENDING_DELETE);
    return u;
  }

  async update(actor: AuthUser, id: number, dto: UpdateUserDto) {
    const old = await this.editable(id);
    if (id === actor.id && dto.isActive === false) throw new BadRequestException('Tidak bisa menonaktifkan akun sendiri');
    if (dto.roleCode && id === actor.id) throw new BadRequestException('Tidak bisa mengubah role akun sendiri');
    // akun wali terikat ke keluarga: tidak bisa diubah ke/dari role staf, buat akun baru saja
    if (dto.roleCode && (dto.roleCode === 'WALI') !== !!old.family_id)
      throw new BadRequestException('Role wali tidak bisa ditukar dengan role staf. Buat akun baru untuk keperluan tersebut.');
    const patch = { name: dto.name ?? old.name, phone: dto.phone ?? old.phone, isActive: dto.isActive ?? old.is_active, roleId: dto.roleCode ? await this.roleId(dto.roleCode) : old.role_id };
    await this.db.exec('UPDATE users SET name = $2, phone = $3, is_active = $4, role_id = $5 WHERE id = $1', [id, patch.name, patch.phone, patch.isActive, patch.roleId]);
    if (dto.isActive === false) await this.db.exec('UPDATE refresh_tokens SET revoked = true WHERE user_id = $1', [id]);
    await this.audit.log(actor.id, 'update', 'user', id, { name: old.name, phone: old.phone, isActive: old.is_active, roleId: old.role_id }, patch);
    return { ok: true };
  }

  async resetPassword(actor: AuthUser, id: number) {
    await this.editable(id);
    const pw = tempPassword();
    await this.db.exec('UPDATE users SET password_hash = $2, must_change_password = true, failed_attempts = 0, locked_until = NULL WHERE id = $1', [id, await hashPassword(pw)]);
    await this.db.exec('UPDATE refresh_tokens SET revoked = true WHERE user_id = $1', [id]);
    await this.audit.log(actor.id, 'reset_password', 'user', id);
    return { temporaryPassword: pw }; // tampil sekali ke PJ/Admin, disampaikan ke pemilik akun
  }

  async unlock(actor: AuthUser, id: number) {
    await this.editable(id);
    await this.db.exec('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [id]);
    await this.audit.log(actor.id, 'buka_kunci', 'user', id);
    return { ok: true };
  }

  async assign(actor: AuthUser, id: number, dto: AssignDto) {
    if (dto.endDate && dto.endDate < dto.startDate) throw new BadRequestException('Tanggal berakhir harus setelah tanggal mulai');
    await this.editable(id);
    const row = await this.db.one('INSERT INTO user_branches(user_id, branch_id, start_date, end_date) VALUES ($1,$2,$3,$4) RETURNING id', [id, dto.branchId, dto.startDate, dto.endDate ?? null]);
    await this.audit.log(actor.id, 'penugasan', 'user', id, null, dto);
    return row;
  }

  async unassign(actor: AuthUser, id: number, ubId: number) {
    const old = await this.db.one('DELETE FROM user_branches WHERE id = $1 AND user_id = $2 RETURNING *', [ubId, id]);
    await this.audit.log(actor.id, 'hapus_penugasan', 'user', id, old ?? null, null);
    return { ok: true };
  }

  // ---------------- Hapus akun (khusus PJ, masa tunggu 30 hari) ----------------
  private onlyPj(actor: AuthUser) {
    if (actor.role !== 'PJ') throw new ForbiddenException('Hanya PJ RTA yang bisa menghapus akun');
  }

  /** Masuk daftar hapus: akun langsung nonaktif & sesi dicabut; dihapus permanen setelah 30 hari kecuali dibatalkan. */
  async requestDelete(actor: AuthUser, id: number, dto: DeleteDto) {
    this.onlyPj(actor);
    if (id === actor.id) throw new BadRequestException('Tidak bisa menghapus akun sendiri');
    const u = await this.db.one('SELECT u.id, u.is_active, r.code AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.deleted_at IS NULL', [id]);
    if (!u) throw new NotFoundException('Akun tidak ditemukan');
    const reason = dto.reason.trim();
    const row = await this.db.tx(async (c) => {
      // kunci akun PJ lain agar dua penghapusan bersamaan tidak menghabiskan semua PJ
      if (u.role === 'PJ') {
        const pjs = await this.db.many(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
          WHERE r.code = 'PJ' AND u.is_active AND u.delete_after IS NULL AND u.deleted_at IS NULL AND u.id <> $1 FOR UPDATE OF u`, [id], c);
        if (!pjs.length) throw new BadRequestException('Harus tersisa minimal satu akun PJ RTA aktif');
      }
      const r = await this.db.one(
        `UPDATE users SET delete_after = CURRENT_DATE + $2::int, delete_reason = $3, delete_requested_by = $4, is_active = false
         WHERE id = $1 AND delete_after IS NULL AND deleted_at IS NULL RETURNING to_char(delete_after, 'YYYY-MM-DD') AS "deleteAfter"`,
        [id, DELETE_GRACE_DAYS, reason, actor.id], c);
      if (!r) throw new BadRequestException('Akun ini sudah ada di daftar hapus');
      await this.db.exec('UPDATE refresh_tokens SET revoked = true WHERE user_id = $1', [id], c);
      return r;
    });
    await this.audit.log(actor.id, 'minta_hapus', 'user', id, { isActive: u.is_active }, { deleteAfter: row.deleteAfter, reason });
    return row;
  }

  /** Batalkan penghapusan selama masa tunggu: akun kembali aktif. */
  async cancelDelete(actor: AuthUser, id: number) {
    this.onlyPj(actor);
    const old = await this.db.one(`SELECT to_char(delete_after, 'YYYY-MM-DD') AS "deleteAfter", delete_reason AS reason FROM users WHERE id = $1 AND delete_after IS NOT NULL AND deleted_at IS NULL`, [id]);
    if (!old) throw new NotFoundException('Akun tidak ada di daftar hapus');
    const n = await this.db.exec(
      `UPDATE users SET delete_after = NULL, delete_reason = NULL, delete_requested_by = NULL, is_active = true, failed_attempts = 0, locked_until = NULL
       WHERE id = $1 AND delete_after IS NOT NULL AND deleted_at IS NULL`, [id]);
    if (!n) throw new BadRequestException('Akun sudah dihapus permanen');
    await this.audit.log(actor.id, 'batal_hapus', 'user', id, old, { isActive: true });
    return { ok: true };
  }

  /** Hapus permanen akun yang masa tunggunya habis. Data login & pribadi dibersihkan; baris dan NAMA tetap ada
   *  agar riwayat (hafalan, pembayaran, LPS, pengajuan, audit) tetap menunjukkan siapa yang membuat/mengubah. */
  async purgeDue() {
    const due = await this.db.many('SELECT id FROM users WHERE delete_after <= CURRENT_DATE AND deleted_at IS NULL');
    for (const { id } of due) {
      const unusable = await hashPassword(randomBytes(32).toString('hex')); // tidak bisa dipakai login
      const done = await this.db.tx(async (c) => {
        const n = await this.db.exec(
          `UPDATE users SET email = 'dihapus-' || id || '@akun.invalid', phone = NULL, password_hash = $2, family_id = NULL,
                  is_active = false, failed_attempts = 0, locked_until = NULL, deleted_at = now()
           WHERE id = $1 AND delete_after <= CURRENT_DATE AND deleted_at IS NULL`, [id, unusable], c);
        if (!n) return false; // dibatalkan di sela proses
        await this.db.exec('DELETE FROM refresh_tokens WHERE user_id = $1', [id], c);
        await this.db.exec('DELETE FROM user_branches WHERE user_id = $1', [id], c);
        return true;
      });
      if (done) await this.audit.log(null, 'hapus_permanen', 'user', id);
    }
    if (due.length) this.log.log(`Hapus permanen: ${due.length} akun`);
  }
}

@Controller('users')
export class UsersController {
  constructor(private s: UsersService) {}
  @Get() @Perm('akun.lihat') list(@Query('q') q?: string, @Query('role') role?: string) { return this.s.list(q, role); }
  @Get('ustadzah') @Perm('ustadzah.lihat') ustadzah(@Query('q') q?: string) { return this.s.list(q, 'USTADZAH'); }
  @Post() @Perm('akun.input') create(@CurrentUser() u: AuthUser, @Body() dto: CreateUserDto) { return this.s.create(u, dto); }
  @Patch(':id') @Perm('akun.edit') update(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) { return this.s.update(u, id, dto); }
  @Post(':id/reset-password') @Perm('akun.edit') reset(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.s.resetPassword(u, id); }
  @Post(':id/unlock') @Perm('akun.edit') unlock(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.s.unlock(u, id); }
  @Post(':id/branches') @Perm('ustadzah.edit') assign(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: AssignDto) { return this.s.assign(u, id, dto); }
  @Post(':id/hapus') @Perm('akun.edit') requestDelete(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: DeleteDto) { return this.s.requestDelete(u, id, dto); }
  @Post(':id/batal-hapus') @Perm('akun.edit') cancelDelete(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.s.cancelDelete(u, id); }
  @Delete(':id/branches/:ubId') @Perm('ustadzah.edit') unassign(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Param('ubId', ParseIntPipe) ubId: number) { return this.s.unassign(u, id, ubId); }
}

@Module({ controllers: [UsersController], providers: [UsersService, AuditService] })
export class UsersModule {}
