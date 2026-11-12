# Dashboard RTA — Fase 1 + 2A + 2B + 3

Dashboard manajemen Rumah Tahfidz Al-Fatihah: santri, keluarga, ustadzah, kelas & capaian hafalan, SPP & pembayaran (termasuk halaman bukti untuk wali), LPS, pengajuan keluar/mutasi, profil, role, akun, audit log. Tampilan tema G (berry #ad1d8e), responsif desktop/tablet/HP.

**Stack:** Bun (runtime + package manager) · NestJS · PostgreSQL (Supabase sebagai database saja) · SQL murni lewat `pg`, tanpa ORM · React (Vite) + Tailwind.

```
apps/api   NestJS, dijalankan langsung oleh Bun tanpa build  → http://localhost:3000
apps/web   React SPA                                          → http://localhost:5173 (proxy /api → API)
docs/      SETUP.md · PANDUAN.md · API.md · prd.md · design.md · diagram draw.io
```

## Yang perlu dipasang

| Alat | Versi | Cara |
|---|---|---|
| **Bun** | ≥ 1.1 | Linux/macOS: `curl -fsSL https://bun.sh/install \| bash` · Windows: `powershell -c "irm bun.sh/install.ps1 \| iex"` |
| **PostgreSQL** | 14+ | Docker (`docker compose up -d db`) **atau** project Supabase |
| Git | — | untuk clone |

Node.js **tidak** diperlukan.

## Mulai dalam 5 langkah

```bash
bun install                                   # 1. semua dependensi (api + web, satu perintah)
docker compose up -d db                       # 2. PostgreSQL lokal (lewati jika pakai Supabase)
cp apps/api/.env.example apps/api/.env        # 3. isi DATABASE_URL & JWT_*_SECRET
bun run db:fresh                              # 4. LOKAL: tabel + data master + akun uji
bun run db:demo                               #    (opsional, HANYA lokal) data contoh 58 santri
bun run api        # terminal 1                # 5. API (auto-reload)
bun run web        # terminal 2                #    web → buka http://localhost:5173
```

Akun uji **lokal** (dari `dev/seed-dev.ts`, wajib ganti password saat login pertama). Di produksi akun ini **tidak** dibuat; lihat [docs/SETUP.md](docs/SETUP.md) bagian B:

| Email | Role | Password |
|---|---|---|
| pj@rta.local | PJ RTA | Rta12345 |
| ustadzah.spy@rta.local | Ustadzah (cabang Supriyadi) | Rta12345 |
| manajer@rta.local | Manajer | Rta12345 |
| wali@rta.local | Wali Santri (hanya dari data contoh `db:demo`) | Rta12345 |

Untuk development (termasuk dengan Claude Code di VS Code), baca **[CLAUDE.md](CLAUDE.md)**: aturan arsitektur, keamanan, domain, dan tema. Perintah penting:

```bash
bun run db:reset     # LOKAL saja: kosongkan DB → migrasi → seed → data contoh
bun run db:fresh     # LOKAL saja: kosongkan DB → migrasi → seed + akun uji, TANPA data contoh
bun run typecheck    # API + web
bun run test:e2e     # 46 skenario API (API harus berjalan, DB hasil db:reset)
```

Pemisahan kode: `apps/api/src` + `scripts/` (migrasi, akun PJ pertama) = produksi; `apps/api/dev/` (reset DB, akun uji, data contoh, simulasi tagihan) dan `apps/api/test/` = **lokal saja**, tidak ikut image Docker.

Dokumentasi: [docs/SETUP.md](docs/SETUP.md) (pasang & deploy) · [docs/PANDUAN.md](docs/PANDUAN.md) (cara pakai per role) · [docs/API.md](docs/API.md) (endpoint).

## Fitur

| Modul | Status |
|---|---|
| Login + kunci akun (3x tunggu 5 menit, 5x kunci 5 jam), refresh token, ganti password | ✅ |
| Profil: data diri, perangkat yang sedang masuk, keluarkan perangkat, keluar dari semua perangkat, preferensi notifikasi & ukuran teks | ✅ |
| Role & permission (checklist per menu), role inti terkunci | ✅ |
| Akun, ustadzah (multi-cabang, pengganti bertanggal akhir), wali (satu keluarga banyak santri) | ✅ |
| Santri: form 4 langkah, ID santri otomatis `RTA-<cabang>-001`, tarif khusus/subsidi (PJ), cuti/aktif, tab hafalan & tagihan | ✅ |
| Pengajuan keluar & mutasi: layar tinjau PJ, cek tunggakan & kelas tujuan, tarik pengajuan, biaya pindah otomatis | ✅ |
| **Kelas & hafalan**: roster per kelas, status input pekan ini, tren 4 pekan, input dengan rumus PRD + validasi | ✅ |
| **SPP (rekap)**: tagihan otomatis tiap tgl 1, daftar ulang, pendaftaran; rekap per santri dengan riwayat 6 bulan | ✅ |
| **Bayar**: kirim tagihan via WhatsApp (satu/terpilih/semua), link bertoken untuk wali, catat tunai/bukti WA, verifikasi PJ, pembatalan beralasan | ✅ |
| **Halaman wali** `/bayar/:token`: rincian tagihan + unggah bukti (dikompres di HP), tanpa login | ✅ |
| **LPS**: draft massal (hafalan ditarik otomatis), Draft → Diperiksa → Disetujui → Terbit, grafik, PDF; ustadzah hanya baca | ✅ |
| Dashboard: santri, keuangan bulan ini, capaian per kelas, progres terbaik, kartu *Perlu tindakan* | ✅ |
| Impor CSV/Excel (.xlsx) & ekspor PDF, audit log | ✅ |
| Pengiriman notifikasi otomatis (WA/email), integrasi mutasi bank (Moota), absensi | Fase 4 |

## Aturan yang ditegakkan server (bukan hanya di tampilan)

- Scope cabang untuk Ustadzah: semua query difilter; data di luar scope dijawab "tidak ditemukan".
- Field sensitif (no. WA, alamat, pekerjaan, catatan kesehatan) dimasking untuk Manajer, termasuk di PDF. Admin Sistem sudah digabung ke PJ RTA.
- Tidak ada hapus permanen: santri keluar diarsipkan; semua perubahan masuk `audit_logs` (siapa, kapan, nilai lama/baru).
- Password di-hash argon2id lewat `Bun.password` (bawaan Bun, tanpa modul native).
- Frontend tidak pernah menyentuh Supabase; hanya API yang memegang koneksi database.
- Status tagihan **dihitung** dari pembayaran terverifikasi (tidak disimpan), jadi tidak bisa tidak sinkron. Pembayaran yang dicatat ustadzah selalu menunggu verifikasi PJ.
- File bukti diperiksa dari isinya (JPG/PNG/WebP/PDF, ≤ 5 MB), disimpan di luar folder publik, dan hanya bisa dibuka lewat API dengan scope cabang.
- Label subsidi tidak pernah dikirim ke Manajer, ke halaman/portal wali, maupun ke pesan WhatsApp.
