import { Global, Injectable, Module } from '@nestjs/common';
import { Pool, types } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';

// Kolom DATE dikembalikan sebagai string 'YYYY-MM-DD', bukan Date (hindari geser hari karena zona waktu)
types.setTypeParser(1082, (v) => v);

/** Pembungkus tipis di atas `pg`: query berparameter, helper one/many, dan transaksi. Tanpa ORM. */
@Injectable()
export class Db {
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

  async many<T extends QueryResultRow = any>(sql: string, params: any[] = [], client?: PoolClient): Promise<T[]> {
    const r = await (client ?? this.pool).query<T>(sql, params);
    return r.rows;
  }
  async one<T extends QueryResultRow = any>(sql: string, params: any[] = [], client?: PoolClient): Promise<T | undefined> {
    return (await this.many<T>(sql, params, client))[0];
  }
  async exec(sql: string, params: any[] = [], client?: PoolClient): Promise<number> {
    const r = await (client ?? this.pool).query(sql, params);
    return r.rowCount ?? 0;
  }
  /** Jalankan beberapa query dalam satu transaksi. */
  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try { await c.query('BEGIN'); const out = await fn(c); await c.query('COMMIT'); return out; }
    catch (e) { await c.query('ROLLBACK'); throw e; }
    finally { c.release(); }
  }
}

@Global()
@Module({ providers: [Db], exports: [Db] })
export class DbModule {}
