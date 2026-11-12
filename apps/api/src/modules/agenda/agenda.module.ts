import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { Db } from '../../db/db.module';
import { CurrentUser, Perm } from '../../common/auth';
import type { AuthUser } from '../../common/auth';
import { AuditService } from '../../common/audit.service';
import { addDays, addMonths, monthStart } from '../../common/time';

export const AGENDA_CATEGORIES = ['KEGIATAN', 'LIBUR', 'UJIAN', 'RAPAT', 'LAINNYA'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_RANGE_DAYS = 400;

class AgendaDto {
  @IsString() @Length(3, 120, { message: 'Judul agenda 3–120 karakter' }) title: string;
  @IsIn(AGENDA_CATEGORIES, { message: 'Kategori agenda tidak dikenal' }) category: (typeof AGENDA_CATEGORIES)[number];
  @Matches(DATE, { message: 'Tanggal mulai tidak valid' }) startDate: string;
  @IsOptional() @Matches(DATE, { message: 'Tanggal selesai tidak valid' }) endDate?: string;
  @IsOptional() @Matches(TIME, { message: 'Jam mulai harus berformat JJ:MM' }) startTime?: string | null;
  @IsOptional() @Matches(TIME, { message: 'Jam selesai harus berformat JJ:MM' }) endTime?: string | null;
  @IsOptional() @IsInt() branchId?: number | null;             // null / kosong = semua cabang
  @IsOptional() @IsString() @MaxLength(120) location?: string | null;
  @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}
class CancelDto { @IsString() @Length(3, 200, { message: 'Alasan pembatalan wajib diisi (minimal 3 karakter)' }) reason: string; }
class ListQuery {
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
  @IsOptional() @IsInt() branchId?: number;
  @IsOptional() @IsIn(['0', '1']) includeCancelled?: '0' | '1';
}

const COLS = `a.id, a.title, a.category, a.start_date AS "startDate", a.end_date AS "endDate",
  to_char(a.start_time, 'HH24:MI') AS "startTime", to_char(a.end_time, 'HH24:MI') AS "endTime",
  a.location, a.note, a.branch_id AS "branchId", b.name AS "branchName",
  cu.name AS "createdBy", a.created_at AS "createdAt", a.updated_at AS "updatedAt",
  a.cancelled_at AS "cancelledAt", a.cancel_reason AS "cancelReason"`;
const FROM = `FROM agendas a LEFT JOIN branches b ON b.id = a.branch_id LEFT JOIN users cu ON cu.id = a.created_by`;
// staf cabang melihat agenda umum (branch_id NULL) + agenda cabangnya; null = semua cabang
const SCOPE = (n: number) => `($${n}::int[] IS NULL OR a.branch_id IS NULL OR a.branch_id = ANY($${n}))`;

@Injectable()
export class AgendaService {
  constructor(private db: Db, private audit: AuditService) {}

  async list(user: AuthUser, q: ListQuery) {
    const from = q.from ?? monthStart();
    const to = q.to ?? addDays(addMonths(from.slice(0, 8) + '01', 1), -1);
    if (to < from) throw new BadRequestException('Rentang tanggal tidak valid');
    if (to > addDays(from, MAX_RANGE_DAYS)) throw new BadRequestException('Rentang tanggal maksimal sekitar satu tahun');
    if (q.branchId && user.branchIds && !user.branchIds.includes(q.branchId)) throw new NotFoundException('Cabang tidak ditemukan');
    const rows = await this.db.many(`SELECT ${COLS} ${FROM}
      WHERE ${SCOPE(1)} AND a.start_date <= $3 AND a.end_date >= $2
        AND ($4::int IS NULL OR a.branch_id IS NULL OR a.branch_id = $4) AND ($5 OR a.cancelled_at IS NULL)
      ORDER BY a.start_date, a.start_time NULLS FIRST, a.id`, [user.branchIds, from, to, q.branchId ?? null, q.includeCancelled === '1']);
    return { from, to, rows };
  }

  async get(user: AuthUser, id: number) {
    const row = await this.db.one(`SELECT ${COLS} ${FROM} WHERE a.id = $2 AND ${SCOPE(1)}`, [user.branchIds, id]);
    if (!row) throw new NotFoundException('Agenda tidak ditemukan');
    return row;
  }

  async create(user: AuthUser, dto: AgendaDto) {
    const v = await this.normalize(user, dto);
    const row = await this.db.one(`INSERT INTO agendas(title, category, start_date, end_date, start_time, end_time, location, note, branch_id, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [v.title, v.category, v.startDate, v.endDate, v.startTime, v.endTime, v.location, v.note, v.branchId, user.id]);
    await this.audit.log(user.id, 'create', 'agenda', row!.id, null, v);
    return { id: row!.id as number };
  }

  async update(user: AuthUser, id: number, dto: AgendaDto) {
    const old = await this.get(user, id);
    if (old.cancelledAt) throw new BadRequestException('Agenda yang sudah dibatalkan tidak bisa diubah');
    const v = await this.normalize(user, dto);
    await this.db.exec(`UPDATE agendas SET title = $2, category = $3, start_date = $4, end_date = $5, start_time = $6, end_time = $7,
      location = $8, note = $9, branch_id = $10, updated_by = $11, updated_at = now() WHERE id = $1`,
      [id, v.title, v.category, v.startDate, v.endDate, v.startTime, v.endTime, v.location, v.note, v.branchId, user.id]);
    await this.audit.log(user.id, 'update', 'agenda', id, this.snapshot(old), v);
    return { ok: true };
  }

  async cancel(user: AuthUser, id: number, dto: CancelDto) {
    const old = await this.get(user, id);
    if (old.cancelledAt) throw new BadRequestException('Agenda ini sudah dibatalkan');
    const reason = dto.reason.trim();
    if (reason.length < 3) throw new BadRequestException('Alasan pembatalan wajib diisi (minimal 3 karakter)');
    await this.db.exec('UPDATE agendas SET cancelled_at = now(), cancelled_by = $2, cancel_reason = $3 WHERE id = $1', [id, user.id, reason]);
    await this.audit.log(user.id, 'cancel', 'agenda', id, this.snapshot(old), { cancelReason: reason });
    return { ok: true };
  }

  /** Rapikan input + validasi lintas field (tanggal/jam, cabang ada & dalam scope). */
  private async normalize(user: AuthUser, dto: AgendaDto) {
    const title = dto.title.trim();
    if (title.length < 3) throw new BadRequestException('Judul agenda 3–120 karakter');
    const endDate = dto.endDate || dto.startDate;
    if (endDate < dto.startDate) throw new BadRequestException('Tanggal selesai tidak boleh sebelum tanggal mulai');
    if (endDate > addDays(dto.startDate, 366)) throw new BadRequestException('Agenda maksimal berlangsung satu tahun');
    const startTime = dto.startTime || null, endTime = dto.endTime || null;
    if (endTime && !startTime) throw new BadRequestException('Isi jam mulai bila jam selesai diisi');
    if (startTime && endTime && endDate === dto.startDate && endTime < startTime) throw new BadRequestException('Jam selesai tidak boleh sebelum jam mulai');
    const branchId = dto.branchId ?? null;
    if (branchId != null) {
      if (user.branchIds && !user.branchIds.includes(branchId)) throw new NotFoundException('Cabang tidak ditemukan');
      if (!(await this.db.one('SELECT 1 FROM branches WHERE id = $1', [branchId]))) throw new BadRequestException('Cabang tidak ditemukan');
    } else if (user.branchIds) throw new BadRequestException('Agenda untuk semua cabang hanya bisa dibuat oleh PJ RTA');
    return { title, category: dto.category, startDate: dto.startDate, endDate, startTime, endTime, branchId,
      location: dto.location?.trim() || null, note: dto.note?.trim() || null };
  }
  private snapshot(a: any) {
    return { title: a.title, category: a.category, startDate: a.startDate, endDate: a.endDate, startTime: a.startTime, endTime: a.endTime,
      branchId: a.branchId, location: a.location, note: a.note };
  }
}

@Controller('agenda')
export class AgendaController {
  constructor(private s: AgendaService) {}
  @Get() @Perm('agenda.lihat') list(@CurrentUser() u: AuthUser, @Query() q: ListQuery) { return this.s.list(u, q); }
  @Get(':id') @Perm('agenda.lihat') get(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.s.get(u, id); }
  @Post() @Perm('agenda.input') create(@CurrentUser() u: AuthUser, @Body() dto: AgendaDto) { return this.s.create(u, dto); }
  @Patch(':id') @Perm('agenda.edit') update(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: AgendaDto) { return this.s.update(u, id, dto); }
  @Post(':id/cancel') @Perm('agenda.edit') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: CancelDto) { return this.s.cancel(u, id, dto); }
}

@Module({ controllers: [AgendaController], providers: [AgendaService, AuditService] })
export class AgendaModule {}
