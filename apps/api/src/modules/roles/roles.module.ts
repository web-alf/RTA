import { BadRequestException, Body, Controller, Get, Injectable, Module, Param, ParseIntPipe, Put } from '@nestjs/common';
import { ArrayUnique, IsArray, IsString } from 'class-validator';
import { Db } from '../../db/db.module';
import { ACTIONS, MENUS } from '../../common/permissions';
import { CurrentUser, Perm } from '../../common/auth';
import type { AuthUser } from '../../common/auth';
import { AuditService } from '../../common/audit.service';

class SetPermsDto { @IsArray() @ArrayUnique() @IsString({ each: true }) perms: string[]; }
const VALID = new Set(MENUS.flatMap((m) => ACTIONS.map((a) => `${m}.${a}`)));
// Role inti tidak boleh kehilangan akses menu Role & Akun
const CORE_KEEP = ['role.lihat', 'role.edit', 'akun.lihat', 'akun.input', 'akun.edit'];

@Injectable()
export class RolesService {
  constructor(private db: Db, private audit: AuditService) {}
  async list() {
    const rs = await this.db.many('SELECT id, code, name, is_core AS "isCore" FROM roles ORDER BY id');
    const ps = await this.db.many('SELECT role_id, perm FROM role_permissions');
    return { menus: MENUS, actions: ACTIONS, roles: rs.map((r) => ({ ...r, perms: ps.filter((p) => p.role_id === r.id).map((p) => p.perm) })) };
  }
  async setPerms(actor: AuthUser, roleId: number, perms: string[]) {
    const r = await this.db.one('SELECT * FROM roles WHERE id = $1', [roleId]);
    if (!r) throw new BadRequestException('Role tidak ditemukan');
    const bad = perms.filter((p) => !VALID.has(p));
    if (bad.length) throw new BadRequestException(`Permission tidak dikenal: ${bad.join(', ')}`);
    if (r.is_core) for (const k of CORE_KEEP) if (!perms.includes(k)) perms.push(k);
    const old = (await this.db.many('SELECT perm FROM role_permissions WHERE role_id = $1', [roleId])).map((p) => p.perm);
    await this.db.tx(async (c) => {
      await c.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
      if (perms.length) await c.query('INSERT INTO role_permissions(role_id, perm) SELECT $1, unnest($2::text[])', [roleId, perms]);
    });
    await this.audit.log(actor.id, 'update', 'role', roleId, { perms: old }, { perms });
    return { ok: true };
  }
}

@Controller('roles')
export class RolesController {
  constructor(private s: RolesService) {}
  @Get() @Perm('role.lihat') list() { return this.s.list(); }
  @Put(':id/perms') @Perm('role.edit') set(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: SetPermsDto) { return this.s.setPerms(u, id, dto.perms); }
}

@Module({ controllers: [RolesController], providers: [RolesService, AuditService] })
export class RolesModule {}
