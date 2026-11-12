import { Pool } from 'pg';
import { DEFAULT_ROLE_PERMS } from '../common/permissions';

/**
 * Seed DATA MASTER (role & izin, cabang & kelas, subsidi awal, surah, alasan status). AMAN untuk produksi:
 * idempotent (ON CONFLICT DO NOTHING), tidak menimpa perubahan PJ, tidak membuat akun maupun data contoh.
 * Dijalankan otomatis saat container start (setelah migrasi) agar izin baru di DEFAULT_ROLE_PERMS ikut tersisip.
 * Akun uji lokal: dev/seed-dev.ts · akun PJ pertama di produksi: scripts/create-admin.ts.
 */
async function main() {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const q = async (sql: string, p: any[] = []) => (await db.query(sql, p)).rows;

  // roles + permission default (prd.md 4.2). Admin Sistem sudah digabung ke PJ RTA (migrasi 004).
  for (const [code, name, isCore] of [
    ['PJ', 'PJ RTA', true],
    ['USTADZAH', 'Ustadzah', false],
    ['MANAJER', 'Manajer / Pimpinan', false],
    ['WALI', 'Wali Santri', false],
  ] as const) {
    await q('INSERT INTO roles(code, name, is_core) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING', [code, name, isCore]);
    await q('INSERT INTO role_permissions(role_id, perm) SELECT id, unnest($2::text[]) FROM roles WHERE code = $1 ON CONFLICT DO NOTHING', [code, DEFAULT_ROLE_PERMS[code]]);
  }

  // cabang & kelas (prd.md 8.1)
  const levelName: Record<string, string> = { JUZ30: 'Juz 30', JUZ29: 'Juz 29', JUZ28: 'Juz 28' };
  for (const [code, name, spp, reg, levels] of [
    ['GNK', 'Genuk', 150000, 350000, ['JUZ30']],
    ['SPY', 'Supriyadi', 150000, 350000, ['JUZ30', 'JUZ29']],
    ['PDR', 'Pedurungan', 150000, 350000, ['JUZ30', 'JUZ29', 'JUZ28']],
    ['NGL', 'Ngaliyan', 200000, 400000, ['JUZ30', 'JUZ29']],
  ] as const) {
    await q('INSERT INTO branches(code, name, spp_standard, registration_fee) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING', [code, name, spp, reg]);
    for (const level of levels)
      await q('INSERT INTO classes(branch_id, level, name) SELECT id, $2, $3 FROM branches WHERE code = $1 ON CONFLICT DO NOTHING', [code, level, `${name} ${levelName[level]}`]);
  }

  // subsidi SPP (prd.md 8.2) — nilai awal; selanjutnya diatur PJ di menu Pengaturan. Kategori yang sudah ada tidak ditimpa.
  const PINDAHAN = 'Hanya santri pindahan';
  for (const [name, kind, percent, sibling, rates] of [
    [
      'Yatim',
      'TARIF',
      null,
      false,
      [
        ['GNK', 5000],
        ['SPY', 5000],
        ['PDR', 5000],
        ['NGL', 5000, PINDAHAN],
      ],
    ],
    [
      'Kurang mampu',
      'TARIF',
      null,
      false,
      [
        ['GNK', 105000],
        ['SPY', 105000],
        ['PDR', 105000],
        ['NGL', 105000, PINDAHAN],
      ],
    ],
    ['Daycare yayasan', 'TARIF', null, false, [['SPY', 125000]]],
    ['Saudara', 'DISKON', 50, true, [['GNK'], ['SPY'], ['PDR'], ['NGL']]],
  ] as [string, string, number | null, boolean, [string, number?, string?][]][]) {
    const [x] = await q('INSERT INTO subsidies(name, kind, percent, is_sibling) VALUES ($1,$2,$3,$4) ON CONFLICT (name) DO NOTHING RETURNING id', [name, kind, percent, sibling]);
    if (x)
      for (const [code, amount, note] of rates)
        await q('INSERT INTO subsidy_rates(subsidy_id, branch_id, amount, note) SELECT $1, id, $3, $4 FROM branches WHERE code = $2 ON CONFLICT DO NOTHING', [
          x.id,
          code,
          amount ?? null,
          note ?? null,
        ]);
  }
  // label subsidi lama (teks bebas) yang namanya sama dengan kategori → ditautkan; tarif santri tidak diubah
  await q(`UPDATE students s SET subsidy_id = x.id, subsidy_label = x.name FROM subsidies x
           WHERE s.subsidy_id IS NULL AND s.subsidy_label IS NOT NULL AND lower(trim(s.subsidy_label)) = lower(x.name)`);

  // referensi surah (urutan hafalan dari surah pertama ke terakhir dalam juz; total 564 / 431 / 137 ayat)
  const SURAH: Record<string, [string, number][]> = {
    JUZ30: [
      ["An-Naba'", 40],
      ["An-Nazi'at", 46],
      ["'Abasa", 42],
      ['At-Takwir', 29],
      ['Al-Infitar', 19],
      ['Al-Mutaffifin', 36],
      ['Al-Insyiqaq', 25],
      ['Al-Buruj', 22],
      ['At-Tariq', 17],
      ["Al-A'la", 19],
      ['Al-Ghasyiyah', 26],
      ['Al-Fajr', 30],
      ['Al-Balad', 20],
      ['Asy-Syams', 15],
      ['Al-Lail', 21],
      ['Ad-Duha', 11],
      ['Al-Insyirah', 8],
      ['At-Tin', 8],
      ["Al-'Alaq", 19],
      ['Al-Qadr', 5],
      ['Al-Bayyinah', 8],
      ['Az-Zalzalah', 8],
      ["Al-'Adiyat", 11],
      ["Al-Qari'ah", 11],
      ['At-Takasur', 8],
      ["Al-'Asr", 3],
      ['Al-Humazah', 9],
      ['Al-Fil', 5],
      ['Quraisy', 4],
      ["Al-Ma'un", 7],
      ['Al-Kausar', 3],
      ['Al-Kafirun', 6],
      ['An-Nasr', 3],
      ['Al-Lahab', 5],
      ['Al-Ikhlas', 4],
      ['Al-Falaq', 5],
      ['An-Nas', 6],
    ],
    JUZ29: [
      ['Al-Mulk', 30],
      ['Al-Qalam', 52],
      ['Al-Haqqah', 52],
      ["Al-Ma'arij", 44],
      ['Nuh', 28],
      ['Al-Jinn', 28],
      ['Al-Muzzammil', 20],
      ['Al-Muddassir', 56],
      ['Al-Qiyamah', 40],
      ['Al-Insan', 31],
      ['Al-Mursalat', 50],
    ],
    JUZ28: [
      ['Al-Mujadilah', 22],
      ['Al-Hasyr', 24],
      ['Al-Mumtahanah', 13],
      ['As-Saff', 14],
      ["Al-Jumu'ah", 11],
      ['Al-Munafiqun', 11],
      ['At-Tagabun', 18],
      ['At-Talaq', 12],
      ['At-Tahrim', 12],
    ],
  };
  for (const [level, list] of Object.entries(SURAH))
    for (const [i, [name, n]] of list.entries()) await q('INSERT INTO surahs(level, ord, name, ayat_count) VALUES ($1,$2,$3,$4) ON CONFLICT (level, ord) DO NOTHING', [level, i + 1, name, n]);

  // alasan status
  if (!(await q('SELECT 1 FROM status_reasons LIMIT 1')).length)
    for (const [kind, label] of [
      ['CUTI', 'Sakit'],
      ['CUTI', 'Keperluan keluarga'],
      ['CUTI', 'Pindah sementara'],
      ['KELUAR', 'Pindah domisili'],
      ['KELUAR', 'Lulus / selesai'],
      ['KELUAR', 'Permintaan wali'],
      ['KELUAR', 'Lainnya'],
    ])
      await q('INSERT INTO status_reasons(kind, label) VALUES ($1,$2)', [kind, label]);
  for (const label of ['Pindah domisili', 'Lebih dekat rumah', 'Lanjut jenjang yang tidak ada di cabang', 'Lainnya'])
    if (!(await q(`SELECT 1 FROM status_reasons WHERE kind = 'MUTASI' AND label = $1`, [label])).length) await q(`INSERT INTO status_reasons(kind, label) VALUES ('MUTASI', $1)`, [label]);

  console.log('Seed data master selesai.');
  await db.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
