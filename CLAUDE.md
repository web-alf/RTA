# CLAUDE.md — Dashboard RTA

Panduan untuk Claude Code (dan developer) saat mengerjakan repo ini. Baca sampai habis sebelum mengubah kode.

## Konteks singkat

Dashboard Rumah Tahfidz Al-Fatihah (Yayasan Al-Fatihah): santri, keluarga/wali, ustadzah, kelas & hafalan, SPP & pembayaran, halaman bukti bayar untuk wali, LPS, pengajuan keluar/mutasi, profil, role, akun, audit. 4 cabang: Genuk, Supriyadi, Pedurungan, Ngaliyan. Pengguna: **PJ RTA** (semua cabang), **Ustadzah** (cabang yang ditugaskan saja), **Manajer** (lihat & ekspor), **Wali Santri** (portal *Anak Saya*: bayar SPP & unduh LPS terbit anaknya). Admin Sistem sudah digabung ke PJ RTA (migrasi 004).

Dokumen acuan (baca bila menyentuh aturan bisnis): `docs/prd.md` (kebutuhan; §16 = keputusan bawaan yang belum dikonfirmasi PJ), `docs/design.md` (bagian **Tema G** = token & aturan responsif), `docs/API.md`, `docs/PANDUAN.md`, `docs/SETUP.md`.

## Stack

- **Bun** sebagai runtime & package manager (bukan Node/npm). Monorepo Bun workspaces.
- `apps/api`: **NestJS 10**, dijalankan langsung oleh Bun (tanpa build). **SQL murni lewat `pg`, tanpa ORM.** PostgreSQL (Supabase hanya sebagai database).
- `apps/web`: **React 18 + Vite + Tailwind 3**, TanStack Query, React Router 6, ikon `lucide-react`. Dev server mem-proxy `/api` → `http://localhost:3000`.

## Perintah

```bash
bun install
docker compose up -d db                 # PostgreSQL lokal (atau isi DATABASE_URL Supabase)
cp apps/api/.env.example apps/api/.env  # isi DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
bun run db:reset                        # LOKAL: kosongkan DB → migrasi → seed → akun uji → data contoh 58 santri
bun run db:fresh                        # LOKAL: sama tapi TANPA data contoh (mulai data real)
bun run db:admin                        # PRODUKSI: akun PJ pertama (ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD)
bun run api                             # http://localhost:3000 (bun --watch)
bun run web                             # http://localhost:5173

bun run typecheck                       # tsc API + web — wajib bersih
bun run test:e2e                        # skenario API; butuh API berjalan + DB hasil db:reset
bun run test:bill [YYYY-MM] [--detail]  # LOKAL: pratinjau SPP "seakan-akan tanggal 1" (bawaan bulan depan); --simpan = buat sungguhan
bun run build                           # build web produksi (apps/web/dist)
bun run build:api                       # build API ke JavaScript (apps/api/dist) untuk hosting Node, mis. cPanel
bun run cron                            # penjadwal sekali jalan (SPP + hapus akun 30 hari); di hosting: node dist/scripts/cron.js tiap jam
```

- `db:migrate` (idempotent, tabel `_migrations`), `db:seed` (data master saja, aman diulang & aman produksi; dijalankan otomatis saat container start), `db:seed-dev` (akun uji, lokal), `db:demo` (data contoh, lokal) bisa dijalankan terpisah.
- **Pemisahan dev/produksi**: kode yang boleh jalan di produksi hanya `src/`, `scripts/` (migrate, create-admin), dan `sql/`. Semua yang mengosongkan DB, membuat akun uji, data contoh, atau simulasi ada di `apps/api/dev/` (wajib menolak `NODE_ENV=production` + host DB non-lokal) dan dikecualikan dari image lewat `.dockerignore`. Jangan menambah akun atau data contoh ke `src/db/seed.ts`.
- `db:reset` dan `db:demo` **menolak** jalan bila `NODE_ENV=production`; `db:reset` juga menolak host DB non-lokal kecuali `ALLOW_DB_RESET=1`. Jangan pernah melonggarkan pengaman ini.
- `test:e2e` mengubah data (membayar tagihan, menyetujui mutasi). Untuk menjalankan ulang: `bun run db:reset` lalu restart API.
- Akun uji (`dev/seed-dev.ts`, tidak ada di produksi): `pj@`, `ustadzah.spy@` (cabang Supriyadi), `manajer@rta.local`, password `Rta12345` (wajib ganti saat login pertama; uji e2e menggantinya ke `Rta12345x`). Data contoh menambah `wali@rta.local` (wali satu keluarga).
- Login dibatasi 10/menit per IP dan akun terkunci setelah 3/5 kali salah. Bila uji gagal 401/429 berulang: restart API (reset throttle) dan `db:reset`.

## Alur kerja yang diharapkan

1. Pahami aturan bisnis terkait di `docs/prd.md` sebelum mengubah logika.
2. Ubah backend → `bun run typecheck` → tambah/ubah skenario di `apps/api/test/e2e.ts` bila perilaku API berubah → `bun run db:reset` + restart API → `bun run test:e2e`.
3. Ubah frontend → `bun run typecheck` → cek di browser pada **1440 px dan 390 px** (desktop & HP), sebagai PJ **dan** ustadzah.
4. Perbarui `docs/API.md` / `docs/PANDUAN.md` bila endpoint atau cara pakai berubah.

## Struktur

```
apps/api/
  sql/NNN_*.sql            migrasi berurutan (001 Fase 1, 002 Fase 2/3, 003 keterangan pendaftaran, 004 gabung Admin→PJ + role WALI, 005 ID santri RTA-<cabang>-NNN, 006 hapus akun 30 hari, 007 tabel settings, 008 master subsidi, 009 ganti nama Saudara, 010 agenda, 011 cicilan pendaftaran, 012 rekening per cabang, 013 kas) — JANGAN ubah file yang sudah rilis, buat file baru
  scripts/migrate.ts       runner migrasi · scripts/create-admin.ts (akun PJ pertama di produksi) · scripts/cron.ts (penjadwal sekali jalan untuk Cron Job)
  tsconfig.build.json      build ke dist/ (CommonJS, tanpa tipe Bun) untuk hosting Node
  dev/                     LOKAL SAJA, tidak ikut image: reset-db.ts, seed-dev.ts (akun uji), demo.ts (data contoh), test-bill.ts
  src/main.ts, app.module.ts
  src/db/db.module.ts      Db: many<T>(), one<T>(), exec() → rowCount, tx(async (client) => …)
  src/db/seed.ts           data master (role/izin, cabang, kelas, subsidi awal, surah, alasan status), aman produksi
  src/common/
    auth.ts                AuthGuard global, @Public(), @Perm('menu.aksi'), @CurrentUser(), AuthUser, assertBranch()
    permissions.ts         MENUS, ACTIONS, DEFAULT_ROLE_PERMS, SENSITIVE_ROLES  ← sumber kebenaran izin
    mask.ts                FAMILY_SENSITIVE, STUDENT_SENSITIVE, mask()
    audit.service.ts       audit.log(actorId|null, action, entity, entityId, oldVal, newVal)
    time.ts                todayWIB, monthStart, weekStart (Senin), addMonths, monthLabel, academicYearStart, rupiah
    password.ts            hashPassword / verifyPassword (argon2id hash-wasm; setara Bun.password, jalan di Bun & Node)
    storage.service.ts     put/get file bukti (disk lokal; ganti adapter untuk Supabase Storage/S3) + sniffImage()
    sql.ts, http.ts        Where builder, AllExceptionsFilter
  src/modules/<nama>/      auth, users, roles, branches, families, students, requests, dashboard, audit, export, import,
                           hafalan, billing (SPP + bayar + publik wali), lps, portal (akun wali: scope users.family_id),
                           settings (menu Pengaturan; SettingsService global, get() untuk aturan keuangan & template WA),
                           subsidies (master subsidi kategori × cabang; SubsidiesService global: resolve, reconcileFamily, rebranch),
                           agenda (menu Agenda; branch_id NULL = semua cabang; batal dengan alasan, tidak dihapus),
                           registration (menu Pendaftaran: daftar & skema cicilan biaya pendaftaran; pakai BillingService.invoicesSql),
                           kas (menu Kas: katalog barang & stok per cabang, penjualan, pengeluaran + persetujuan, laporan PDF)
  test/e2e.ts
apps/web/src/
  main.tsx                 rute; /login dan /bayar/:token publik, sisanya di dalam <Layout/>
  lib/api.ts               get/post/patch/put/del/download, ApiError, can(user, perm), tgl(), rupiah()
  lib/auth.tsx             AuthProvider, useAuth()
  lib/image.ts             compressImage() untuk unggahan bukti
  components/ui.tsx        pustaka komponen tema G (lihat bawah)
  components/Layout.tsx    rail berlabel / rail ikon / tab bar bawah + sheet Lainnya + menu avatar; MENU = daftar menu
  components/Toast.tsx     useToast() → toast(text, 'success' | 'danger')
  pages/*.tsx              satu file per halaman
```

## Aturan backend (wajib)

**Keamanan & data**
- **Akun wali (role WALI)**: `branchIds = []` (tidak melihat data cabang mana pun); data hanya lewat `/portal/*` yang men-scope ke `users.family_id` (dibaca ulang dari DB). Jangan beri wali izin menu staf.
- **Scope cabang di setiap query.** Pola: `($1::int[] IS NULL OR x.branch_id = ANY($1))` dengan `user.branchIds` (`null` = semua cabang). Data di luar scope dijawab **404, bukan 403**, agar keberadaan data tidak bocor.
- **Setiap endpoint diberi `@Perm('menu.aksi')`** kecuali yang memang `@Public()`. Izin baru → tambahkan ke `DEFAULT_ROLE_PERMS` di `permissions.ts` (seed menyisipkan pasangan yang belum ada).
- **Field sensitif dimasking** untuk role di luar `SENSITIVE_ROLES` (PJ, USTADZAH): no. WA, HP cadangan, alamat, pekerjaan, catatan kesehatan, **label subsidi**. Pakai `mask()`; berlaku juga di PDF/ekspor.
- **Label subsidi tidak pernah** dikirim ke Manajer, wali (halaman publik & portal), maupun pesan WhatsApp. Begitu juga `subsidyId`/`subsidySince` dan master `/subsidies` (hanya `spp.input`).
- **Tidak ada hapus permanen.** Arsipkan, batalkan dengan alasan, atau `voided_at`. Semua perubahan dicatat `audit.log(...)` dengan nilai lama & baru. Satu-satunya pengecualian: **hapus akun** (PJ saja, daftar hapus 30 hari, `users.delete_after`/`deleted_at`) yang membersihkan data login & pribadi tapi **tetap menyimpan baris dan nama** agar referensi `recorded_by`/`created_by` dll. tetap terbaca. Query daftar akun wajib `deleted_at IS NULL`.
- Parameter SQL selalu `$n`; jangan pernah menyambung input pengguna ke string SQL.
- Jangan menulis data pribadi (no. WA, alamat, nominal per keluarga, token) ke log.
- File unggahan: cek isi dengan `sniffImage()` (JPG/PNG/WebP/PDF), batas 5 MB, simpan lewat `StorageService`, layani hanya lewat endpoint yang memeriksa scope. Jangan pernah membuat folder storage publik.
- Endpoint publik (`/public/*`) wajib `@Throttle` dan hanya mengembalikan data minimum (nama panggilan, label, nominal).

**Konvensi kode**
- Bun: **impor tipe wajib `import type`** (decorator metadata Bun gagal pada impor tipe biasa), dan setiap paket yang di-`import` harus ada di `package.json` workspace itu (Bun tidak meng-hoist).
- **Kode di `src/` dan `scripts/` harus jalan di Bun dan Node** (API bisa di-deploy ke hosting Node lewat `bun run build:api`). Jangan pakai API `Bun.*` maupun top-level await/`import.meta` di sana; password lewat `common/password.ts`. `build:api` gagal bila aturan ini dilanggar. Skrip `dev/` boleh khusus Bun.
- IP pengunjung dibaca dari `req.ip` (mengikuti `TRUST_PROXY` di `main.ts`), jangan langsung dari header `X-Forwarded-For`.
- Satu modul = satu file `<nama>.module.ts` berisi DTO (class-validator), Service, Controller, `@Module`; daftarkan di `app.module.ts`. Modul lama yang lebih besar dipecah (students).
- Kolom SQL `snake_case`, keluaran API `camelCase` lewat alias `AS "camelCase"`.
- Tanggal bisnis memakai **WIB** lewat `common/time.ts`; jangan pakai `new Date()` mentah untuk menentukan bulan/pekan.
- Pesan error untuk pengguna dalam Bahasa Indonesia yang jelas dan sopan (`BadRequestException('…')`).
- Skema berubah → **file migrasi baru** `sql/003_….sql`. Jangan edit migrasi yang sudah pernah dijalankan di lingkungan mana pun.

## Aturan domain (jangan diubah tanpa persetujuan PJ)

- **Hafalan**: capaian = (jumlah ayat surah sebelumnya dalam juz + ayat posisi terakhir) ÷ total ayat juz × 100. Total: Juz 30 = 564, Juz 29 = 431, Juz 28 = 137 (tabel `surahs`, urutan hafalan dari An-Naba'/Al-Mulk/Al-Mujadilah). Input per pekan (Senin WIB); hanya santri **Aktif**; ayat > jumlah ayat surah ditolak; posisi turun butuh `confirmLower`.
- **Tagihan**: SPP dibuat otomatis untuk santri Aktif yang masuk ≤ tgl 1 (penjadwal tiap jam + saat start, atau Cron Job `scripts/cron.ts` di hosting tanpa proses permanen; idempotent lewat indeks unik). Daftar ulang per tahun pembelajaran (nominal & bulan mulai dari Pengaturan; bawaan Rp100.000, Juli). Pendaftaran dibuat saat santri baru. Mutasi yang disetujui menagih biaya pindah sebagai daftar ulang; **tidak ditagih dua kali** dalam satu tahun.
- **Subsidi** (prd.md 8.2): master `subsidies` + `subsidy_rates` (per cabang). Tarif santri = `SubsidiesService.resolve()` (TARIF = nominal, DISKON = % dari tarif standar cabang); jangan hitung tarif subsidi di tempat lain. Setiap perubahan status / mutasi wajib memanggil `reconcileFamily()` (diskon saudara) dan `rebranch()` (mutasi) di dalam transaksinya, lalu `logChanges()`.
- **Status tagihan tidak disimpan**, selalu diturunkan dari alokasi pembayaran (`INVOICE_STATUS_SQL` di billing): LUNAS · MENUNGGU · TUNGGAKAN (periode < bulan ini) · BELUM. Jangan menambah kolom status.
- **Cicilan pendaftaran**: satu cicilan = satu tagihan `PENDAFTARAN` (`installment_no/total`, `due_date`), dibuat lewat `/registrations/:id/plan` (tagihan lama di-void). Status TERJADWAL/TUNGGAKAN per jatuh tempo diturunkan di `INVOICE_STATUS_SQL`; jangan membuat jalur bayar sebagian.
- **Pembukuan terpisah**: menu SPP = tagihan `SPP` + `DAFTAR_ULANG` (`SPP_MENU_TYPES` di billing), menu Pendaftaran = `PENDAFTARAN`, menu Kas = penjualan barang (termasuk pelunasan tagihan `BARANG`) − pengeluaran. Jangan menjumlahkan uang menu lain ke Kas. Ekspor Excel/PDF lewat `common/report.ts` (`sendXlsx`, `sendPdf`), dicatat di `export_logs`.
- **Kas**: Stok = `SUM(stock_moves.delta)` per barang per cabang (jangan simpan angka stok); ubah stok selalu lewat `stock_moves` dengan `pg_advisory_xact_lock(hashtext('stok'), branch_id)`. Jual "Tagihkan ke wali" = tagihan `BARANG` (dikecualikan dari indeks unik `invoice_unique_idx`, jadi `ON CONFLICT` tagihan lain memakai `WHERE voided_at IS NULL AND type <> 'BARANG'`). Pengeluaran tanpa `kas.setujui` → MENUNGGU. Kategori/barang dinonaktifkan, tidak dihapus.
- **Pembayaran**: nominal harus sama dengan tagihan yang dipilih (bayar sebagian belum didukung). Hanya pengguna dengan `bayar.setujui` (PJ) yang bisa memverifikasi; entri ustadzah selalu `MENUNGGU`. Tolak/batal wajib alasan; tidak dihapus.
- **Link wali**: token acak, disimpan sebagai hash SHA-256, berlaku `linkDays` hari (bawaan 30), link lama dicabut saat link baru dibuat.
- **Rekening transfer per cabang** (`branches.bank_*`, `SettingsService.banks()`): PJ mengubah semua, ustadzah hanya cabangnya (`pengaturan.input`, scope cabang). Kosong = rekening bawaan yayasan (`SETTING_DEFAULTS.bank*`). Halaman wali menampilkan rekening cabang dari tagihannya.
- **Pengaturan**: nilai bisnis yang bisa diubah PJ (biaya daftar ulang, bulan mulai tahun ajaran, masa link, template WA) dibaca lewat `SettingsService.get()`. **Jangan** menulis nilai tetap atau `process.env` baru untuk aturan bisnis; tambahkan kunci ke `SETTING_DEFAULTS`. Tarif per cabang tetap di `branches`.
- **LPS**: DRAFT → DIPERIKSA → DISETUJUI → TERBIT; revisi kembali ke DRAFT dengan catatan. Diisi PJ; ustadzah hanya baca & unduh yang terbit. Aspek: BTQ, Tahsin, Adab, Doa harian; nilai: Sangat baik / Baik / Perlu latihan.
- **ID santri**: `RTA-<kode cabang pendaftaran>-<urut per cabang, 3 digit>` (mis. `RTA-GNK-001`), dibuat di `StudentsService.nextNis` dengan advisory lock per cabang; **tidak berubah saat mutasi**. ID lama di `legacy_nis`.
- **Pengajuan keluar/mutasi**: entitas terpisah dari status; selama MENUNGGU santri tetap Aktif di cabang asal; satu pengajuan menunggu per santri; cabang/kelas asal disimpan (`from_branch_id`). Setelah mutasi disetujui, ustadzah asal tidak lagi melihat santri itu.

## Aturan frontend (tema G)

- **Pakai komponen di `components/ui.tsx`** sebelum membuat yang baru: `PageHeader`, `Card`, `Stat`, `Avatar`, `IconTile`, `Badge` (semua status: AKTIF, CUTI, LUNAS, TUNGGAKAN, DRAFT, TERBIT, …), `Chips`, `Segmented`, `SearchBox`, `Toggle`, `Field`, `Alert`, `Dialog`, `Drawer` (panel kanan di desktop, sheet bawah di HP), `KV`, grafik `Ring` / `StackBar` / `Bar` / `Spark`, dan konstanta `COLOR`.
- Kelas CSS bersama di `index.css`: `.card`, `.btn-primary|secondary|soft|text|danger|wa`, `.icon-btn`, `.input`, `.label`, `.th`, `.td`, `.pill`, `.chip-on|off`, `.h1`, `.h2`, `.num`, `.scroll-x`. Jangan menulis warna hex baru di halaman; pakai token Tailwind (`brand-*`, `n-*`, `rose|butter|lilac|mint-bg/fg`, `success|warning|danger|info`).
- **Responsif wajib**: tabel `hidden md:block` + daftar kartu `md:hidden` untuk HP; target sentuh ≥ 44 px; aksi utama di HP menempel di bawah atau tombol mengambang (`bottom-[104px]` agar di atas tab bar); `pb-32` sudah disediakan `Layout` di HP.
- Ukuran HP: tepi 20 px, antarbagian 24 px (`space-y-5/6`), antarkartu 12 px (`gap-3`), padding kartu 16 px (`p-4`), avatar 40 px, tombol 48 px.
- Teks putih hanya di atas berry (`brand-600`) atau hijau tua (`success`), tidak di atas pastel. Grafik selalu punya `label` (aria) yang menjelaskan angkanya.
- Data dari API lewat TanStack Query (`useQuery` + `get`); setelah mutasi `queryClient.invalidateQueries(...)`. Sembunyikan aksi dengan `can(user, 'menu.aksi')`, tapi **server tetap sumber kebenaran**.
- Menu baru → tambah ke `MENU` di `Layout.tsx` (dengan `perm`) dan ke `MENUS` di `permissions.ts`.
- Hal yang hanya berlaku untuk ustadzah (cabang terkunci, hanya baca) ditunjukkan di UI dengan chip 🔒 cabang / "Hanya baca".

## Bahasa & nada

- Semua teks antarmuka, pesan error, dan dokumentasi dalam **Bahasa Indonesia**. Gunakan "santri", "wali", "ustadzah", "PJ RTA", "SPP", "LPS", "mutasi".
- Teks untuk **wali** (halaman `/bayar/:token`, pesan WA): hangat, santun, ringkas, unsur keislaman secukupnya ("Assalamu'alaikum", "Jazakumullahu khairan"). Pesan WA maksimal 4–5 baris, selalu berisi link. Tanpa nada menekan, tanpa menyebut kategori subsidi.
- Teks untuk tim: lugas dan teknis.
- Jangan mengarang data di UI atau seed produksi (nama program, nominal, testimoni). Data contoh hanya di `dev/demo.ts`.
- Jangan menulis opini/fatwa keagamaan di aplikasi maupun dokumentasi.

## Yang belum ada / batasan yang disengaja

- Pembayaran sebagian, notifikasi otomatis (WA/email), integrasi mutasi bank (Moota), absensi → Fase 4. Preferensi notifikasi sudah tersimpan di `users.prefs`.
- Penyimpanan bukti masih disk lokal (`STORAGE_DIR`); di Docker wajib volume (`rta_storage`).
- Keputusan bawaan di `docs/prd.md` §16 belum dikonfirmasi PJ. Bila mengubah perilaku terkait, perbarui tabel itu.

## Sebelum menyatakan selesai

- [ ] `bun run typecheck` dan `bun run build:api` bersih
- [ ] `bun run db:reset` + restart API + `bun run test:e2e` → **SEMUA LULUS** (tambahkan skenario untuk perilaku baru)
- [ ] Dicek di 1440 px dan 390 px, sebagai PJ dan ustadzah; tidak ada error di console
- [ ] Endpoint baru punya `@Perm`, scope cabang, masking, dan audit log
- [ ] Dokumentasi terkait diperbarui
