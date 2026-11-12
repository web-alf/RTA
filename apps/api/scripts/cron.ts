/**
 * Penjadwal sekali jalan, untuk hosting yang prosesnya bisa ditidurkan/di-restart (mis. cPanel "Setup Node.js App"/Passenger),
 * sehingga timer per jam di dalam API tidak bisa diandalkan. Jalankan TIAP JAM lewat Cron Job:
 *
 *   Node (hasil build):  cd ~/rta-api && node dist/scripts/cron.js
 *   Bun (lokal):         bun run cron
 *
 * Isinya sama persis dengan penjadwal di dalam API (keduanya idempotent, aman bila sempat jalan berbarengan):
 * - BillingService.generateMonthly(): tagihan SPP bulan berjalan untuk santri Aktif (indeks unik mencegah dobel)
 * - UsersService.purgeDue(): hapus permanen akun yang masa tunggu 30 harinya habis
 * Di hosting yang memakai cron ini, isi DISABLE_SCHEDULER=true pada env aplikasi agar timer di dalam API tidak ikut jalan.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { Db } from '../src/db/db.module';
import { BillingService } from '../src/modules/billing/billing.module';
import { UsersService } from '../src/modules/users/users.module';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Env DATABASE_URL belum diisi (lihat .env.example)');
  process.env.DISABLE_SCHEDULER = 'true'; // proses ini sekali jalan: jangan pasang timer per jam
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const db = app.get(Db);
  try {
    const spp = await app.get(BillingService).generateMonthly();
    await app.get(UsersService).purgeDue();
    console.log(`cron selesai: ${spp.created} tagihan SPP baru (periode ${spp.period})`);
  } catch (e) {
    console.error('cron gagal:', (e as Error).message);
    process.exitCode = 1;
  } finally {
    await app.close();
    await db.pool.end(); // tutup koneksi agar proses langsung selesai
  }
}
main();
