import { Controller, Get, Query, Injectable, Module } from '@nestjs/common';
import { Db } from '../../db/db.module';
import { CurrentUser } from '../../common/auth';
import type { AuthUser } from '../../common/auth';

@Injectable()
export class BranchesService {
  constructor(private db: Db) {}
  /** semua=true: daftar cabang tujuan mutasi (tidak sensitif), di luar scope pengguna */
  async all(user: AuthUser, semua = false) {
    const bs = await this.db.many('SELECT id, code, name, spp_standard AS "sppStandard", registration_fee AS "registrationFee" FROM branches WHERE is_active ORDER BY id');
    const cs = await this.db.many('SELECT id, branch_id AS "branchId", level, name FROM classes ORDER BY id');
    const visible = user.branchIds && !semua ? bs.filter((b) => user.branchIds!.includes(b.id)) : bs;
    return visible.map((b) => ({ ...b, classes: cs.filter((c) => c.branchId === b.id) }));
  }
  /** Menu Kelas: daftar kelas + jumlah santri per status, sesuai scope */
  classesWithCounts(user: AuthUser) {
    return this.db.many(
      `SELECT c.id, c.name, c.level, c.branch_id AS "branchId", b.name AS "branchName",
              COUNT(s.id) FILTER (WHERE s.status = 'AKTIF')::int  AS aktif,
              COUNT(s.id) FILTER (WHERE s.status = 'CUTI')::int   AS cuti,
              COUNT(s.id) FILTER (WHERE s.status = 'INDENT')::int AS indent
       FROM classes c JOIN branches b ON b.id = c.branch_id
       LEFT JOIN students s ON s.class_id = c.id
       WHERE ($1::int[] IS NULL OR c.branch_id = ANY($1))
       GROUP BY c.id, b.name ORDER BY c.id`, [user.branchIds]);
  }
  reasons() { return this.db.many('SELECT id, kind, label FROM status_reasons WHERE is_active ORDER BY kind, id'); }
}

@Controller()
export class BranchesController {
  constructor(private s: BranchesService) {}
  @Get('branches') all(@CurrentUser() u: AuthUser, @Query('semua') semua?: string) { return this.s.all(u, semua === '1'); }
  @Get('classes') classes(@CurrentUser() u: AuthUser) { return this.s.classesWithCounts(u); }
  @Get('status-reasons') reasons() { return this.s.reasons(); }
}

@Module({ controllers: [BranchesController], providers: [BranchesService] })
export class BranchesModule {}
