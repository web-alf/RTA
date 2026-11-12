/**
 * HANYA UNTUK LOKAL: uji tagihan SPP bulanan "seakan-akan tanggal 1".
 * Menjalankan fungsi penjadwal yang sama persis (BillingService.generateMonthly) untuk bulan tertentu, lalu merangkum
 * siapa yang ditagih dan siapa yang tidak (beserta alasannya).
 *
 *   bun run test:bill                    → pratinjau tanggal 1 bulan depan (tidak ada yang disimpan)
 *   bun run test:bill 2026-12            → pratinjau tanggal 1 bulan tertentu
 *   bun run test:bill 2026-12 --detail   → + daftar santri per kelompok (ID, nama panggilan, cabang, tarif)
 *   bun run test:bill 2026-12 --simpan   → tagihan BENAR-BENAR dibuat (terlihat di menu SPP/Bayar & oleh wali)
 *
 * Ditolak bila NODE_ENV=production atau DATABASE_URL bukan host lokal, kecuali ALLOW_TEST_BILL=1 (database uji).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { BillingService } from '../src/modules/billing/billing.module';
import { AuditService } from '../src/common/audit.service';
import { Db } from '../src/db/db.module';
import { addMonths, monthLabel, monthStart, rupiah } from '../src/common/time';

const url = process.env.DATABASE_URL ?? '';
const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
if (process.env.NODE_ENV === 'production') { console.error('Ditolak: NODE_ENV=production.'); process.exit(1); }
if (!['localhost', '127.0.0.1', 'db'].includes(host) && process.env.ALLOW_TEST_BILL !== '1') {
  console.error(`Ditolak: host database "${host}" bukan lokal. Set ALLOW_TEST_BILL=1 bila memang database uji.`); process.exit(1);
}

const args = process.argv.slice(2);
const dry = !args.includes('--simpan'), detail = args.includes('--detail');
const month = args.find((a) => !a.startsWith('--'));
if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { console.error('Format bulan harus YYYY-MM, mis. 2026-12'); process.exit(1); }
const period = month ? `${month}-01` : addMonths(monthStart(), 1);

process.env.DISABLE_SCHEDULER = 'true'; // penjadwal tiap jam tidak ikut jalan di script ini
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const db = app.get(Db), billing = app.get(BillingService), audit = app.get(AuditService, { strict: false });
class Rollback extends Error {}

console.log(`\nSimulasi tanggal 1 ${monthLabel(period)} (${period})${dry ? ' · PRATINJAU, tidak disimpan' : ''}\n`);
try {
  await db.tx(async (c) => {
    const { created } = await billing.generateMonthly(period, c);
    // now() = waktu mulai transaksi ini → baris yang dibuat oleh simulasi barusan
    const perBranch = await db.many(`SELECT b.name, COUNT(*)::int AS n, SUM(i.amount)::int AS total FROM invoices i JOIN branches b ON b.id = i.branch_id
      WHERE i.type = 'SPP' AND i.period = $1 AND i.created_at = now() GROUP BY b.id, b.name ORDER BY b.id`, [period], c);
    const rows = await db.many(`SELECT s.nis, COALESCE(s.nickname, split_part(s.full_name, ' ', 1)) AS name, b.name AS branch, s.spp_rate AS rate,
        CASE WHEN i.id IS NOT NULL AND i.created_at = now() THEN 'Ditagih sekarang'
             WHEN i.id IS NOT NULL THEN 'Sudah punya tagihan bulan ini (tidak dibuat ulang)'
             WHEN s.status <> 'AKTIF' THEN 'Tidak ditagih: status ' || s.status
             WHEN s.join_date > $1::date THEN 'Tidak ditagih: bergabung setelah tgl 1'
             ELSE 'Tidak ditagih: tarif SPP Rp0' END AS grp
      FROM students s JOIN branches b ON b.id = s.branch_id
      LEFT JOIN invoices i ON i.student_id = s.id AND i.type = 'SPP' AND i.period = $1::date AND i.voided_at IS NULL
      ORDER BY 5, b.id, s.nis`, [period], c);

    console.log(`Tagihan SPP dibuat: ${created}`);
    for (const b of perBranch) console.log(`  ${b.name.padEnd(12)} ${String(b.n).padStart(3)} santri  ${rupiah(b.total)}`);
    console.log('\nRingkasan semua santri:');
    const groups = [...new Set(rows.map((r) => r.grp))];
    for (const g of groups) {
      const list = rows.filter((r) => r.grp === g);
      console.log(`  ${String(list.length).padStart(3)}  ${g}`);
      if (detail) for (const r of list) console.log(`         ${r.nis}  ${r.name.padEnd(12)} ${r.branch.padEnd(11)} ${rupiah(r.rate)}`);
    }
    if (dry) throw new Rollback();
    await audit.log(null, 'generate', 'invoice', null, null, { type: 'SPP', period, count: created, sumber: 'test:bill' }, c);
  });
  console.log(`\nTersimpan. Lihat di menu SPP → pilih ${monthLabel(period)}. Dijalankan ulang → tidak ada tagihan ganda.`);
  console.log('Tagihan ini nyata. Database contoh bisa diulang dengan "bun run db:reset" (MENGHAPUS SEMUA DATA, termasuk hasil impor).');
} catch (e) {
  if (!(e instanceof Rollback)) throw e;
  console.log('\nPratinjau selesai, tidak ada yang disimpan. Tambahkan --simpan untuk benar-benar membuat tagihan.');
}
await app.close();
process.exit(0);
