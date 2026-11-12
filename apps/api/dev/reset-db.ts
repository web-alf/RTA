/**
 * HANYA UNTUK LOKAL: hapus semua tabel (schema public) agar migrasi + seed + demo bisa diulang dari nol.
 * Ditolak bila NODE_ENV=production atau DATABASE_URL bukan host lokal (localhost/127.0.0.1/db), kecuali ALLOW_DB_RESET=1.
 */
import { Pool } from 'pg';
const url = process.env.DATABASE_URL ?? '';
const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
if (process.env.NODE_ENV === 'production') { console.error('Ditolak: NODE_ENV=production.'); process.exit(1); }
if (!['localhost', '127.0.0.1', 'db'].includes(host) && process.env.ALLOW_DB_RESET !== '1') {
  console.error(`Ditolak: host database "${host}" bukan lokal. Set ALLOW_DB_RESET=1 bila memang database uji.`); process.exit(1);
}
const pool = new Pool({ connectionString: url });
await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await pool.end();
console.log(`Database ${host} dikosongkan.`);
