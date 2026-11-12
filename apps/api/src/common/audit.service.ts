import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.module';
import type { PoolClient } from 'pg';

@Injectable()
export class AuditService {
  constructor(private db: Db) {}
  /** `client`: catat di dalam transaksi pemanggil (ikut batal bila transaksi di-rollback). */
  log(actorId: number | null, action: string, entity: string, entityId: number | null, oldValue: unknown = null, newValue: unknown = null, client?: PoolClient) {
    return this.db.exec('INSERT INTO audit_logs(actor_id, action, entity, entity_id, old_value, new_value) VALUES ($1,$2,$3,$4,$5,$6)',
      [actorId, action, entity, entityId, oldValue == null ? null : JSON.stringify(oldValue), newValue == null ? null : JSON.stringify(newValue)], client);
  }
}
