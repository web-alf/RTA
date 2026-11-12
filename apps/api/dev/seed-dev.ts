/**
 * LOKAL SAJA: akun uji (pj@, ustadzah.spy@, manajer@rta.local) dengan password SEED_PASSWORD (bawaan Rta12345, wajib ganti saat login pertama).
 * Jalankan setelah src/db/seed.ts (butuh role & cabang). Ditolak bila NODE_ENV=production atau host database bukan lokal, kecuali ALLOW_DB_RESET=1.
 * Akun PJ pertama di produksi dibuat dengan scripts/create-admin.ts, bukan file ini.
 */
import { Pool } from 'pg';

const host = (() => { try { return new URL(process.env.DATABASE_URL ?? '').hostname; } catch { return ''; } })();
if (process.env.NODE_ENV === 'production') { console.error('Ditolak: NODE_ENV=production. Pakai scripts/create-admin.ts untuk akun produksi.'); process.exit(1); }
if (!['localhost', '127.0.0.1', 'db'].includes(host) && process.env.ALLOW_DB_RESET !== '1') {
  console.error(`Ditolak: host database "${host}" bukan lokal. Set ALLOW_DB_RESET=1 bila memang database uji.`); process.exit(1);
}

async function main() {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const q = async (sql: string, p: any[] = []) => (await db.query(sql, p)).rows;

  const pw = await Bun.password.hash(process.env.SEED_PASSWORD ?? 'Rta12345', { algorithm: 'argon2id' });
  for (const [name, email, code] of [
    ['PJ RTA', 'pj@rta.local', 'PJ'],
    ['Ustadzah Supriyadi', 'ustadzah.spy@rta.local', 'USTADZAH'],
    ['Manajer', 'manajer@rta.local', 'MANAJER'],
  ])
    await q('INSERT INTO users(name, email, password_hash, role_id) SELECT $1, $2, $3, id FROM roles WHERE code = $4 ON CONFLICT (email) DO NOTHING', [name, email, pw, code]);
  await q(`INSERT INTO user_branches(user_id, branch_id, start_date)
           SELECT u.id, b.id, '2026-01-01' FROM users u, branches b WHERE u.email = 'ustadzah.spy@rta.local' AND b.code = 'SPY'
           AND NOT EXISTS (SELECT 1 FROM user_branches WHERE user_id = u.id)`);

  console.log('Akun uji dibuat: pj@rta.local, ustadzah.spy@rta.local, manajer@rta.local (password: ' + (process.env.SEED_PASSWORD ?? 'Rta12345') + ')');
  await db.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
