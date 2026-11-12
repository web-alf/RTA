/**
 * DATA CONTOH untuk uji coba & demo. JANGAN dijalankan di database produksi.
 * Membuat ±60 santri di 4 cabang, riwayat hafalan 4 pekan, tagihan 6 bulan dengan status campuran, dan draft LPS.
 * Aman diulang: berhenti bila santri contoh sudah ada.
 */
import { Pool } from 'pg';
import { addDays, addMonths, monthLabel, monthStart, weekStart } from '../src/common/time';

if (process.env.NODE_ENV === 'production') {
  console.error('Ditolak: jangan isi data contoh di produksi.');
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql: string, p: any[] = []) => pool.query(sql, p);

const NAMES = [
  'Aisyah Putri',
  'Zahra Nabila',
  'Hafidz Ali',
  'Rafi Pratama',
  'Salma Azzahra',
  'Umar Faruq',
  'Nadia Putri',
  'Ilham Ramadhan',
  'Alya Rahmah',
  'Kayla Basri',
  'Rizki Basri',
  'Hana Salsabila',
  'Raka Pratama',
  'Syifa Maulida',
  'Fikri Ananda',
  'Dzaki Ramadhan',
  'Salsa Khairunnisa',
  'Khansa Aulia',
  'Dimas Saputra',
  'Yusuf Hakim',
  'Fatimah Zahra',
  'Nabil Akbar',
  'Hilmi Fauzan',
  'Azka Pratama',
  'Naura Aqila',
  'Kenzo Alfarizi',
  'Arsy Hanifah',
  'Gibran Malik',
  'Shafa Kamila',
  'Rayyan Hakim',
  'Medina Azzahra',
  'Faiz Ramadhan',
  'Kirana Ayu',
  'Athar Rizqi',
  'Qonita Husna',
  'Zaidan Akbar',
  'Inara Safa',
  'Fathan Alif',
  'Nayla Putri',
  'Haikal Aditya',
  'Aqila Nur',
  'Bilal Hamzah',
  'Hasna Faiha',
  'Daffa Arkan',
  'Luthfi Aziz',
  'Mikayla Rahma',
  'Arkan Malik',
  'Sabrina Lail',
  'Ghazi Rafif',
  'Alesha Nur',
  'Fakhri Akmal',
  'Hanin Qirani',
  'Ibrahim Yusuf',
  'Jihan Aulia',
  'Kahfi Ramadhan',
  'Laila Hanum',
  'Musa Alfarabi',
  'Nisa Hilwa',
];
const FATHERS = [
  'Rahmat Hidayat',
  'Budi Santoso',
  'Joko Prasetyo',
  'Ahmad Fauzi',
  'Hasan Basri',
  'Hendra Wijaya',
  'Agus Salim',
  'Arif Rahman',
  'Dodi Kurniawan',
  'Lukman Hakim',
  'Yusuf Maulana',
  'Fajar Nugroho',
  'Imam Syafii',
  'Rudi Hartono',
  'Slamet Riyadi',
  'Teguh Wibowo',
  'Wahyu Hidayat',
  'Bambang Susilo',
  'Eko Prasetyo',
  'Gilang Ramadhan',
  'Heri Setiawan',
  'Indra Gunawan',
  'Kurniawan Adi',
  'Mulyadi Saputra',
  'Nanang Kosim',
  'Oki Firmansyah',
  'Purnomo Aji',
  'Rizal Effendi',
  'Sugeng Raharjo',
  'Taufik Hidayat',
  'Udin Samsudin',
  'Viktor Hamid',
  'Wawan Setiadi',
  'Yanto Sudrajat',
  'Zainal Abidin',
  'Arifin Ilham',
  'Darmawan Putra',
  'Fauzan Azima',
];
const rnd = (() => {
  let x = 42;
  return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
})();

async function main() {
  const {
    rows: [{ n }],
  } = await q(`SELECT COUNT(*)::int AS n FROM status_history WHERE note = 'Data contoh'`);
  if (n > 0) {
    console.log('Data contoh sudah ada, dilewati.');
    return pool.end();
  }
  const classes = (await q('SELECT c.id, c.level, c.branch_id, b.code, b.spp_standard FROM classes c JOIN branches b ON b.id = c.branch_id ORDER BY c.id')).rows;
  // ID santri RTA-<kode cabang>-NNN, melanjutkan nomor terakhir per cabang
  const seq: Record<string, number> = {};
  for (const r of (await q(`SELECT substring(nis FROM '^RTA-([A-Z]+)-') AS code, MAX(substring(nis FROM '-([0-9]+)$')::int) AS n FROM students WHERE nis LIKE 'RTA-%' GROUP BY 1`)).rows)
    seq[r.code] = r.n;
  const surahs = (await q('SELECT id, level, ord, ayat_count FROM surahs ORDER BY level, ord')).rows;
  const pj = (await q(`SELECT id FROM users WHERE email = 'pj@rta.local'`)).rows[0];
  if (!pj) throw new Error('Akun uji pj@rta.local belum ada. Jalankan "bun run db:seed-dev" dulu.');
  const actor = pj.id;
  const thisMonth = monthStart();
  const ws = weekStart();
  let fi = 0;
  const families: number[] = [];
  for (const f of FATHERS) {
    const r = await q(`INSERT INTO families(father_name, mother_name, wa_phone, address, father_job, mother_job) VALUES ($1,$2,$3,$4,'Wiraswasta','Ibu rumah tangga') RETURNING id`, [
      f,
      'Ibu ' + f.split(' ')[1],
      '0812' + String(10000000 + fi * 7919).slice(0, 8),
      `Jl. Contoh No. ${fi + 1}, Semarang`,
    ]);
    families.push(r.rows[0].id);
    fi++;
  }
  // akun wali contoh (portal "Anak Saya") untuk keluarga pertama
  const pw = await Bun.password.hash(process.env.SEED_PASSWORD ?? 'Rta12345', {
    algorithm: 'argon2id',
  });
  await q(`INSERT INTO users(name, email, password_hash, role_id, family_id) SELECT $1, 'wali@rta.local', $2, id, $3 FROM roles WHERE code = 'WALI' ON CONFLICT (email) DO NOTHING`, [
    FATHERS[0],
    pw,
    families[0],
  ]);
  const saudara = (await q("SELECT id FROM subsidies WHERE name = 'Saudara'")).rows[0]?.id ?? null;
  for (const [i, name] of NAMES.entries()) {
    const c = classes[i % classes.length];
    const fam = families[i % families.length];
    const status = i === 9 || i === 20 ? 'CUTI' : i === 21 ? 'KELUAR' : 'AKTIF';
    const sub = i % 11 === 3 && saudara; // diskon saudara 50% (prd.md 8.2)
    const rate = sub ? Math.round(c.spp_standard / 2) : c.spp_standard;
    const join = addMonths(thisMonth, -(6 + (i % 10)));
    const st = (
      await q(
        `INSERT INTO students(nis, full_name, nickname, gender, birth_place, birth_date, family_id, branch_id, class_id, status, join_date, spp_rate, subsidy_label, registration_note, subsidy_id, subsidy_since)
      VALUES ($1,$2,$3,$4,'Semarang','2017-03-04',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [
          `RTA-${c.code}-${String((seq[c.code] = (seq[c.code] ?? 0) + 1)).padStart(3, '0')}`,
          name,
          name.split(' ')[0],
          i % 2 ? 'L' : 'P',
          fam,
          c.branch_id,
          c.id,
          status,
          join,
          rate,
          sub ? 'Saudara' : null,
          i % 4 === 0 ? 'Data contoh: daftar lewat WhatsApp' : null,
          sub || null,
          sub ? join : null,
        ],
      )
    ).rows[0].id;
    await q(`INSERT INTO status_history(student_id, from_status, to_status, effective_date, actor_id, note) VALUES ($1,NULL,$2,$3,$4,'Data contoh')`, [st, status, join, actor]);
    // hafalan 4 pekan (naik bertahap; sebagian belum diinput pekan ini; satu datar)
    const juz = surahs.filter((s) => s.level === c.level);
    const total = juz.reduce((a, s) => a + s.ayat_count, 0);
    let pos = Math.floor(total * (0.1 + rnd() * 0.5));
    for (let k = 3; k >= 0; k--) {
      if (status !== 'AKTIF') break;
      if (k === 0 && i % 7 === 4) break; // belum diinput pekan ini
      const gain = i % 13 === 6 && k < 2 ? 0 : 6 + Math.floor(rnd() * 14);
      pos = Math.min(total, pos + gain);
      let acc = 0,
        sur = juz[0],
        ay = 1;
      for (const s of juz) {
        if (acc + s.ayat_count >= pos) {
          sur = s;
          ay = pos - acc;
          break;
        }
        acc += s.ayat_count;
      }
      await q(`INSERT INTO memorization_records(student_id, branch_id, class_id, level, surah_id, ayat, total_ayat, percent, week_start, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
        st,
        c.branch_id,
        c.id,
        c.level,
        sur.id,
        Math.max(1, ay),
        pos,
        Math.round((pos / total) * 1000) / 10,
        addDays(ws, -7 * k),
        actor,
      ]);
    }
    // tagihan 6 bulan + pembayaran campuran
    if (status === 'KELUAR') continue;
    for (let m = 5; m >= 0; m--) {
      const period = addMonths(thisMonth, -m);
      if (status === 'CUTI' && m < 3) continue;
      const inv = (
        await q(`INSERT INTO invoices(student_id, family_id, branch_id, type, period, label, amount) VALUES ($1,$2,$3,'SPP',$4,$5,$6) RETURNING id`, [
          st,
          fam,
          c.branch_id,
          period,
          `SPP ${monthLabel(period)}`,
          rate,
        ])
      ).rows[0].id;
      const overdue = i % 9 === 1 && m < 3; // tunggakan beberapa bulan
      const unpaidNow = m === 0 && i % 4 === 2; // belum bayar bulan ini
      const pendingNow = m === 0 && i % 6 === 0; // menunggu verifikasi
      if (overdue || unpaidNow) continue;
      const state = pendingNow ? 'MENUNGGU' : 'TERVERIFIKASI';
      const p = (
        await q(`INSERT INTO payments(family_id, amount, paid_at, method, source, state, recorded_by, verified_by, verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [
          fam,
          rate,
          addDays(period, 3 + (i % 9)),
          i % 5 === 0 ? 'TUNAI' : 'TRANSFER',
          i % 5 === 0 ? 'TUNAI' : 'WA',
          state,
          actor,
          state === 'TERVERIFIKASI' ? actor : null,
          state === 'TERVERIFIKASI' ? new Date() : null,
        ])
      ).rows[0].id;
      await q('INSERT INTO payment_allocations(payment_id, invoice_id, amount) VALUES ($1,$2,$3)', [p, inv, rate]);
    }
  }
  // ---- Kas: katalog barang contoh + stok awal per cabang + beberapa pengeluaran disetujui (menu Kas) ----
  const cat = async (name: string) => (await q('SELECT id FROM item_categories WHERE name = $1', [name])).rows[0]?.id;
  const [buku, seragam, perl] = [await cat('Buku & mushaf'), await cat('Seragam'), await cat('Perlengkapan')];
  const branchIds = (await q('SELECT id FROM branches ORDER BY id')).rows.map((r) => r.id);
  if (buku && seragam && perl) {
    const ITEMS: [number, string, number, number][] = [
      [buku, 'Iqro jilid 1', 25000, 20],
      [buku, 'Iqro jilid 2', 25000, 20],
      [buku, 'Iqro jilid 3', 25000, 15],
      [buku, 'Iqro jilid 4', 25000, 0],
      [buku, 'Mushaf A5', 60000, 12],
      [buku, 'Buku prestasi hafalan', 15000, 40],
      [seragam, 'Seragam S', 85000, 1],
      [seragam, 'Seragam M', 85000, 6],
      [seragam, 'Seragam L', 85000, 4],
      [perl, 'Kaos olahraga', 65000, 18],
    ];
    for (const [c, name, price, qty] of ITEMS) {
      const id = (await q('INSERT INTO items(category_id, name, price) VALUES ($1,$2,$3) RETURNING id', [c, name, price])).rows[0].id;
      if (qty)
        for (const b of branchIds) await q(`INSERT INTO stock_moves(item_id, branch_id, delta, kind, note, created_by) VALUES ($1,$2,$3,'KOREKSI','Stok awal (data contoh)',$4)`, [id, b, qty, actor]);
    }
    const ecat = async (name: string) => (await q('SELECT id FROM expense_categories WHERE name = $1', [name])).rows[0].id;
    const EXP: [string, string, number, number][] = [
      ['Listrik & air', 'Token listrik', 200000, 0],
      ['ATK', 'Spidol & kertas absen', 65000, 1],
      ['Konsumsi kegiatan', 'Snack murajaah bersama', 240000, 2],
    ];
    for (const [k, [cname, desc, amount, b]] of EXP.entries())
      for (let m = 0; m < 3; m++)
        await q(
          `INSERT INTO expenses(branch_id, category_id, amount, description, spent_at, method, state, decided_by, decided_at, created_by) VALUES ($1,$2,$3,$4,$5,'TRANSFER','DISETUJUI',$6,now(),$6)`,
          [branchIds[b % branchIds.length], await ecat(cname), amount, desc, addDays(addMonths(monthStart(), -m), 4 + k * 5), actor],
        );
  }

  console.log(`Data contoh dibuat: ${NAMES.length} santri, ${FATHERS.length} keluarga, akun wali contoh wali@rta.local.`);
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
