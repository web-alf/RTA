/**
 * Buat akun PJ RTA pertama (produksi / database baru). Dipakai sekali; akun berikutnya dibuat PJ lewat menu Akun.
 *
 *   ADMIN_NAME="Nama PJ" ADMIN_EMAIL=pj@alfatihah.com ADMIN_PASSWORD='…' bun run db:admin
 *
 * - Butuh migrasi + seed data master (role PJ) sudah dijalankan.
 * - Password minimal 8 karakter; akun tetap wajib ganti password saat login pertama.
 * - Ditolak bila email sudah terdaftar. Tercatat di audit_logs (password tidak ikut dicatat).
 */
import { Pool } from 'pg';
import { hashPassword } from '../src/common/password';

const name = process.env.ADMIN_NAME?.trim();
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD ?? '';
if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Isi ADMIN_NAME dan ADMIN_EMAIL (format email yang valid).'); process.exit(1);
}
if (password.length < 8) { console.error('ADMIN_PASSWORD minimal 8 karakter.'); process.exit(1); }

async function main() {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const role = (await client.query(`SELECT id FROM roles WHERE code = 'PJ'`)).rows[0];
    if (!role) throw new Error('Role PJ belum ada. Jalankan "bun run db:migrate" dan "bun run db:seed" dulu.');
    const hash = await hashPassword(password);
    const row = (await client.query(
      'INSERT INTO users(name, email, password_hash, role_id) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING RETURNING id',
      [name, email, hash, role.id],
    )).rows[0];
    if (!row) throw new Error('Email sudah terdaftar. Tidak ada yang diubah.');
    await client.query('INSERT INTO audit_logs(actor_id, action, entity, entity_id, old_value, new_value) VALUES (NULL, $1, $2, $3, NULL, $4)',
      ['create', 'user', row.id, JSON.stringify({ name, email, role: 'PJ', via: 'scripts/create-admin.ts' })]);
    await client.query('COMMIT');
    console.log(`Akun PJ dibuat (id ${row.id}). Login lalu ganti password.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error((e as Error).message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.end();
  }
}
main();
