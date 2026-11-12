// Menjalankan semua file SQL di apps/api/sql/ secara berurutan. Idempotent: file yang sudah jalan dicatat di tabel _migrations.
// Jalan di Bun (bun scripts/migrate.ts) maupun Node hasil build (node dist/scripts/migrate.js).
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

// scripts/ → ../sql (sumber) · dist/scripts/ → ../../sql (hasil build)
const dir = [join(__dirname, '..', 'sql'), join(__dirname, '..', '..', 'sql')].find((d) => existsSync(d));

async function main() {
  if (!dir) throw new Error('Folder sql/ tidak ditemukan. Pastikan folder sql ikut diunggah di samping dist/.');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, run_at timestamptz DEFAULT now())');
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if ((await c.query('SELECT 1 FROM _migrations WHERE name=$1', [f])).rowCount) continue;
      await c.query('BEGIN');
      try { await c.query(readFileSync(join(dir, f), 'utf8')); await c.query('INSERT INTO _migrations(name) VALUES($1)', [f]); await c.query('COMMIT'); console.log('migrasi:', f); }
      catch (e) { await c.query('ROLLBACK'); throw e; }
    }
    console.log('selesai');
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
