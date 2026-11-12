import { BadRequestException, Body, Controller, Get, Global, Injectable, Module, NotFoundException, Param, ParseIntPipe, Patch } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { Db } from '../../db/db.module';
import { CurrentUser, Perm } from '../../common/auth';
import type { AuthUser } from '../../common/auth';
import { AuditService } from '../../common/audit.service';

/** Nilai bawaan bila PJ belum pernah mengubah (env lama tetap dihormati sebagai bawaan). */
export const SETTING_DEFAULTS = {
  reregistrationFee: Number(process.env.REREGISTRATION_FEE ?? 100000),
  academicYearStartMonth: Number(process.env.ACADEMIC_YEAR_START_MONTH ?? 7),
  linkDays: 30,
  registrationMinDp: 100000,           // cicilan pendaftaran: DP minimal
  registrationMaxInstallments: 3,      // cicilan pendaftaran: maks. kali bayar (termasuk DP)
  // rekening bawaan yayasan: hanya cadangan untuk cabang yang belum mengisi rekening sendiri (branches.bank_*)
  bankName: process.env.BANK_NAME ?? 'Bank Syariah',
  bankAccount: process.env.BANK_ACCOUNT ?? '7xxx xxx xxx',
  bankHolder: process.env.BANK_HOLDER ?? 'Yayasan Al-Fatihah',
  waTemplate: "Assalamu'alaikum Bapak/Ibu 🌿\nTagihan {tagihan} untuk {nama}: {total}.\nRincian dan unggah bukti transfer: {link}\nJazakumullahu khairan 🤍",
};
export type Settings = typeof SETTING_DEFAULTS;
export const WA_PLACEHOLDERS = ['tagihan', 'nama', 'total', 'link'];
const MAX_FEE = 10_000_000;

/** Isi template WA. Placeholder yang tidak dikenal sudah ditolak saat disimpan. */
export const renderWa = (tpl: string, v: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);

class SettingsDto {
  @IsOptional() @IsInt() @Min(0) @Max(MAX_FEE) reregistrationFee?: number;
  @IsOptional() @IsInt() @Min(1) @Max(12) academicYearStartMonth?: number;
  @IsOptional() @IsInt() @Min(1, { message: 'Masa berlaku link minimal 1 hari' }) @Max(90, { message: 'Masa berlaku link maksimal 90 hari' }) linkDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_FEE) registrationMinDp?: number;
  @IsOptional() @IsInt() @Min(1, { message: 'Maksimal cicilan minimal 1 (1 = tidak bisa dicicil)' }) @Max(6, { message: 'Maksimal cicilan 6 kali' }) registrationMaxInstallments?: number;
  @IsOptional() @IsString() @MaxLength(500, { message: 'Template WA maksimal 500 karakter' }) waTemplate?: string;
}
class BranchBankDto {
  @IsString() @Length(2, 60, { message: 'Nama bank 2–60 karakter' }) bankName: string;
  @IsString() @Matches(/^[0-9 .-]{4,40}$/, { message: 'Nomor rekening hanya angka (boleh spasi/titik/strip), 4–40 karakter' }) bankAccount: string;
  @IsString() @Length(2, 80, { message: 'Atas nama 2–80 karakter' }) bankHolder: string;
}
export type BranchBank = { branchId: number; branchName: string; name: string; account: string; holder: string; isDefault: boolean };
class BranchFeeDto {
  @IsInt() @Min(0) @Max(MAX_FEE) sppStandard: number;
  @IsInt() @Min(0) @Max(MAX_FEE) registrationFee: number;
  @IsOptional() @IsBoolean() applyToStudents?: boolean; // ikut ubah santri yang tarifnya masih = tarif standar lama
}

@Injectable()
export class SettingsService {
  constructor(private db: Db, private audit: AuditService) {}

  async get(): Promise<Settings> {
    const rows = await this.db.many('SELECT key, value FROM settings');
    const out: any = { ...SETTING_DEFAULTS };
    for (const r of rows) if (r.key in out) out[r.key] = r.value;
    return out;
  }

  /** Rekening transfer per cabang; cabang yang belum mengisi memakai rekening bawaan yayasan (isDefault). */
  async banks(branchIds: number[] | null): Promise<BranchBank[]> {
    const cfg = await this.get();
    const rows = await this.db.many(
      `SELECT id, name, bank_name, bank_account, bank_holder FROM branches WHERE is_active AND ($1::int[] IS NULL OR id = ANY($1)) ORDER BY id`, [branchIds]);
    return rows.map((b) => ({
      branchId: b.id, branchName: b.name, isDefault: !b.bank_account,
      name: b.bank_account ? b.bank_name : cfg.bankName, account: b.bank_account || cfg.bankAccount, holder: b.bank_account ? b.bank_holder : cfg.bankHolder,
    }));
  }

  /** Ustadzah (scope cabang) hanya melihat cabangnya; nilai global tetap tampil read-only. */
  async view(user: AuthUser) {
    const values = await this.get();
    const last = await this.db.one(`SELECT s.updated_at AS "updatedAt", u.name AS "updatedBy" FROM settings s LEFT JOIN users u ON u.id = s.updated_by ORDER BY s.updated_at DESC LIMIT 1`);
    const branches = await this.db.many(
      `SELECT b.id, b.code, b.name, b.spp_standard AS "sppStandard", b.registration_fee AS "registrationFee",
         (SELECT COUNT(*) FROM students s WHERE s.branch_id = b.id AND s.status <> 'KELUAR')::int AS santri,
         (SELECT COUNT(*) FROM students s WHERE s.branch_id = b.id AND s.status <> 'KELUAR' AND s.subsidy_id IS NULL AND s.spp_rate = b.spp_standard)::int AS "santriTarifStandar",
         (SELECT COUNT(*) FROM students s JOIN subsidies x ON x.id = s.subsidy_id WHERE s.branch_id = b.id AND s.status <> 'KELUAR' AND x.kind = 'DISKON')::int AS "santriDiskon"
       FROM branches b WHERE b.is_active AND ($1::int[] IS NULL OR b.id = ANY($1)) ORDER BY b.id`, [user.branchIds]);
    const banks = await this.banks(user.branchIds);
    const { bankName, bankAccount, bankHolder, ...rest } = values;
    return { values: rest, defaults: SETTING_DEFAULTS, placeholders: WA_PLACEHOLDERS, branches, banks, updatedAt: last?.updatedAt ?? null, updatedBy: last?.updatedBy ?? null };
  }

  /** Rekening satu cabang. PJ semua cabang; ustadzah hanya cabangnya (di luar scope = 404). */
  async updateBank(user: AuthUser, id: number, dto: BranchBankDto) {
    const b = await this.db.one('SELECT id, bank_name, bank_account, bank_holder FROM branches WHERE id = $1 AND is_active AND ($2::int[] IS NULL OR id = ANY($2))', [id, user.branchIds]);
    if (!b) throw new NotFoundException('Cabang tidak ditemukan');
    const next = { bankName: dto.bankName.trim(), bankAccount: dto.bankAccount.trim().replace(/\s+/g, ' '), bankHolder: dto.bankHolder.trim() };
    if (next.bankName === b.bank_name && next.bankAccount === b.bank_account && next.bankHolder === b.bank_holder) return { ok: true, changed: false };
    await this.db.exec('UPDATE branches SET bank_name = $2, bank_account = $3, bank_holder = $4 WHERE id = $1', [id, next.bankName, next.bankAccount, next.bankHolder]);
    await this.audit.log(user.id, 'ubah_rekening', 'branch', id, { bankName: b.bank_name, bankAccount: b.bank_account, bankHolder: b.bank_holder }, next);
    return { ok: true, changed: true };
  }

  async update(user: AuthUser, dto: SettingsDto) {
    const cur = await this.get();
    const next: Partial<Settings> = {};
    for (const k of Object.keys(SETTING_DEFAULTS) as (keyof Settings)[]) {
      let v: any = (dto as any)[k];
      if (v === undefined) continue;
      if (typeof v === 'string') v = v.trim();
      if (k === 'waTemplate') this.checkTemplate(v);
      if (v !== cur[k]) (next as any)[k] = v;
    }
    if (!Object.keys(next).length) return { ok: true, changed: 0 };
    await this.db.tx(async (c) => {
      for (const [k, v] of Object.entries(next))
        await c.query(`INSERT INTO settings(key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, now())
                       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, [k, JSON.stringify(v), user.id]);
    });
    const old = Object.fromEntries(Object.keys(next).map((k) => [k, (cur as any)[k]]));
    await this.audit.log(user.id, 'update', 'settings', null, old, next);
    return { ok: true, changed: Object.keys(next).length };
  }

  /** Pesan WA wali: wajib memuat {link}, maksimal 5 baris, hanya placeholder yang dikenal. */
  private checkTemplate(t: string) {
    if (!t.includes('{link}')) throw new BadRequestException('Template WA wajib memuat {link}');
    if (t.split('\n').length > 5) throw new BadRequestException('Template WA maksimal 5 baris');
    const unknown = [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => !WA_PLACEHOLDERS.includes(k));
    if (unknown.length) throw new BadRequestException(`Placeholder tidak dikenal: ${[...new Set(unknown)].map((k) => `{${k}}`).join(', ')}`);
  }

  /** Tarif cabang. Tagihan yang sudah terbit tidak berubah; tarif santri hanya ikut bila applyToStudents. */
  async updateBranch(user: AuthUser, id: number, dto: BranchFeeDto) {
    const b = await this.db.one('SELECT id, name, spp_standard, registration_fee FROM branches WHERE id = $1 AND is_active', [id]);
    if (!b) throw new NotFoundException('Cabang tidak ditemukan');
    const moved = await this.db.tx(async (c) => {
      await c.query('UPDATE branches SET spp_standard = $2, registration_fee = $3 WHERE id = $1', [id, dto.sppStandard, dto.registrationFee]);
      if (!dto.applyToStudents || dto.sppStandard === b.spp_standard) return 0;
      const std = (await c.query(`UPDATE students SET spp_rate = $3 WHERE branch_id = $1 AND status <> 'KELUAR' AND subsidy_id IS NULL AND spp_rate = $2`, [id, b.spp_standard, dto.sppStandard])).rowCount ?? 0;
      // subsidi jenis diskon (% dari tarif standar) ikut dihitung ulang
      const disc = (await c.query(`UPDATE students s SET spp_rate = ROUND($2 * (100 - x.percent) / 100.0)::int FROM subsidies x
        WHERE x.id = s.subsidy_id AND x.kind = 'DISKON' AND s.branch_id = $1 AND s.status <> 'KELUAR'`, [id, dto.sppStandard])).rowCount ?? 0;
      return std + disc;
    });
    await this.audit.log(user.id, 'update', 'branch', id, { sppStandard: b.spp_standard, registrationFee: b.registration_fee },
      { sppStandard: dto.sppStandard, registrationFee: dto.registrationFee, santriDiubah: moved });
    return { ok: true, santriDiubah: moved };
  }
}

@Controller('settings')
export class SettingsController {
  constructor(private s: SettingsService) {}
  @Get() @Perm('pengaturan.lihat') view(@CurrentUser() u: AuthUser) { return this.s.view(u); }
  @Patch('branches/:id/bank') @Perm('pengaturan.input') bank(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: BranchBankDto) { return this.s.updateBank(u, id, dto); }
  @Patch() @Perm('pengaturan.edit') update(@CurrentUser() u: AuthUser, @Body() dto: SettingsDto) { return this.s.update(u, dto); }
  @Patch('branches/:id') @Perm('pengaturan.edit') branch(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: BranchFeeDto) { return this.s.updateBranch(u, id, dto); }
}

@Global()
@Module({ controllers: [SettingsController], providers: [SettingsService, AuditService], exports: [SettingsService] })
export class SettingsModule {}
