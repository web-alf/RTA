import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { Db } from '../../db/db.module';
import { Perm } from '../../common/auth';

@Injectable()
export class AuditQueryService {
  constructor(private db: Db) {}
  list(entity?: string, entityId?: number) {
    return this.db.many(
      `SELECT a.id, a.action, a.entity, a.entity_id AS "entityId", a.old_value AS "oldValue", a.new_value AS "newValue", u.name AS actor, a.created_at AS "createdAt"
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
       WHERE ($1::text IS NULL OR a.entity = $1) AND ($2::int IS NULL OR a.entity_id = $2) ORDER BY a.created_at DESC LIMIT 200`, [entity || null, entityId ? Number(entityId) : null]);
  }
}

@Controller('audit')
export class AuditController {
  constructor(private s: AuditQueryService) {}
  @Get() @Perm('audit.lihat') list(@Query('entity') e?: string, @Query('entityId') id?: number) { return this.s.list(e, id); }
}

@Module({ controllers: [AuditController], providers: [AuditQueryService] })
export class AuditModule {}
