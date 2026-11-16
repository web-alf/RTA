# SETUP — pasang, jalankan, deploy

## Prasyarat

| Alat | Keterangan |
|---|---|
| **Bun ≥ 1.1** | Runtime sekaligus package manager. Node.js tidak diperlukan. Cek: `bun --version` |
| **PostgreSQL 14+** | Docker lokal, atau project Supabase |
| Docker (opsional) | Hanya untuk PostgreSQL lokal atau menjalankan API sebagai container |

Pasang Bun:
- Linux / macOS: `curl -fsSL https://bun.sh/install | bash` lalu buka terminal baru.
- Windows: `powershell -c "irm bun.sh/install.ps1 | iex"`.

## A. Development di komputer sendiri

### 1. Dependensi
```bash
bun install
```
Satu perintah di root memasang `apps/api` dan `apps/web` (Bun workspaces). Bun memblokir skrip postinstall paket yang tidak dipercaya; itu normal dan tidak memengaruhi apa pun di proyek ini.

### 2. Database
Pilih salah satu.

**Docker (paling cepat):**
```bash
docker compose up -d db
# DATABASE_URL=postgres://rta:rta@localhost:5432/rta
```

**Supabase:**
1. Buat project di supabase.com → *Project Settings → Database*.
2. Salin connection string **Session pooler** (port 5432). Ganti `[YOUR-PASSWORD]`.
3. Itu menjadi `DATABASE_URL`. Supabase dipakai **sebagai database saja**: tidak perlu Supabase Auth atau Storage. Aktifkan RLS di semua tabel (*Table Editor → Enable RLS*) agar anon key tidak bisa membaca data; API memakai koneksi langsung sehingga tidak terpengaruh RLS.

### 3. Konfigurasi API
```bash
cp apps/api/.env.example apps/api/.env
```
Isi minimal:
```
DATABASE_URL=postgres://...
JWT_ACCESS_SECRET=<acak panjang>      # contoh: openssl rand -hex 32
JWT_REFRESH_SECRET=<acak panjang, berbeda>
WEB_ORIGIN=http://localhost:5173
PUBLIC_WEB_URL=http://localhost:5173   # dasar link tagihan yang dikirim ke wali
BANK_NAME=…  BANK_ACCOUNT=…  BANK_HOLDER=…   # nilai awal rekening di halaman wali (selanjutnya diatur di menu Pengaturan)
STORAGE_DIR=./storage                  # folder bukti pembayaran
```
Variabel lain (lihat `.env.example`): `REREGISTRATION_FEE` (default 100000), `ACADEMIC_YEAR_START_MONTH` (default 7 = Juli), `DISABLE_SCHEDULER`.
Rekening, biaya daftar ulang, bulan mulai tahun ajaran, masa berlaku link wali, template WA, dan tarif cabang **diatur PJ di menu Pengaturan** (tabel `settings` / `branches`). Env di atas hanya nilai awal selama PJ belum menyimpan.
Bun memuat `.env` otomatis dari folder `apps/api` saat skrip dijalankan dari sana.

### 4. Tabel dan data awal
```bash
bun run db:migrate   # menjalankan apps/api/sql/*.sql berurutan (idempotent, tercatat di tabel _migrations)
bun run db:seed      # data master: role & izin, 4 cabang, 8 kelas, subsidi awal, surah, alasan status (tanpa akun, tanpa santri)
bun run db:seed-dev  # LOKAL: akun uji pj@ / ustadzah.spy@ / manajer@rta.local (apps/api/dev/seed-dev.ts)
```
Password akun uji default `Rta12345` (ubah dengan env `SEED_PASSWORD`). `db:seed-dev` menolak jalan di produksi / host database non-lokal.

Mulai data real di database lokal yang sudah berisi data uji/demo: `bun run db:fresh` (kosongkan → migrasi → seed + akun uji, **tanpa** data contoh; pengaman host lokal sama dengan `db:reset`). File bukti di `STORAGE_DIR` tidak ikut terhapus; bersihkan manual bila isinya bukti uji.

Opsional untuk mencoba semua fitur: `bun run db:demo` mengisi 58 santri contoh, riwayat hafalan 4 pekan, dan tagihan 6 bulan dengan status campuran. **Hanya untuk lokal/uji**; skrip menolak berjalan bila `NODE_ENV=production`.

### 5. Jalankan
```bash
bun run api   # terminal 1 → http://localhost:3000 (bun --watch, auto-reload)
bun run web   # terminal 2 → http://localhost:5173
```
Buka http://localhost:5173, login `pj@rta.local`. Anda akan diminta ganti password.

### Mengubah skema database
Tanpa ORM: tulis SQL langsung.
1. Buat file baru di `apps/api/sql/`, misalnya `002_tambah_kolom.sql` (nomor urut menentukan urutan).
2. Isi dengan `ALTER TABLE ...` / `CREATE TABLE ...`.
3. `bun run db:migrate` → file yang belum pernah dijalankan dieksekusi dalam transaksi dan dicatat di `_migrations`.

Jangan mengubah file yang sudah pernah dijalankan; buat file baru.

### Pola query di kode
- Semua query ada di service tiap modul (`apps/api/src/modules/*`), SQL berparameter (`$1, $2, ...`). Tidak pernah menyambung string input pengguna ke SQL.
- Pembungkus `Db` (`src/db/db.module.ts`): `many()`, `one()`, `exec()`, `tx()` untuk transaksi.
- Kolom snake_case di database, dialias ke camelCase di SELECT (`full_name AS "fullName"`).
- Scope cabang: `($1::int[] IS NULL OR s.branch_id = ANY($1))` — `NULL` = semua cabang, array = cabang ustadzah.

### Catatan khusus Bun
- API dijalankan langsung dari TypeScript (`bun src/main.ts`), tidak ada tahap build.
- Import yang hanya tipe harus ditulis `import type { ... }` (Bun tidak menghapus import tipe yang bercampur dengan nilai, dan NestJS membutuhkan `emitDecoratorMetadata`). `bun run --cwd apps/api typecheck` menjalankan `tsc --noEmit` untuk memeriksa.
- Hash password memakai `hash-wasm` (argon2id berbasis WASM) lewat `src/common/password.ts`, jadi jalan di Bun maupun Node tanpa modul native. Parameternya sama dengan bawaan `Bun.password` (m=65536, t=2, p=1), sehingga hash lama tetap terbaca. Jangan memakai API `Bun.*` di `src/` atau `scripts/`: `bun run build:api` akan gagal.

## B. Deploy ke produksi

### Database
- Supabase paket berbayar (free tier bisa di-pause saat tidak aktif). Pakai connection string **pooler**.
- Backup: selain backup bawaan Supabase, jadwalkan `pg_dump` harian ke storage terpisah.

### API
**Opsi 1 — Docker (disarankan):**
```bash
docker build -f apps/api/Dockerfile -t rta-api .
docker run -d --env-file apps/api/.env -p 3000:3000 rta-api
```
Container menjalankan migrasi → seed data master (idempotent; menyisipkan izin baru) → start API. Folder `apps/api/dev/`, `apps/api/test/`, `docs/`, dan `apps/web` tidak ikut image (`.dockerignore`). Atau `docker compose --profile full up -d` untuk db + api sekaligus.

**Opsi 2 — Bun langsung di VPS:**
```bash
bun install --production
cd apps/api && bun scripts/migrate.ts && bun src/db/seed.ts && bun src/main.ts
```
Jangan jalankan apa pun dari `apps/api/dev/` di server produksi.
Jaga prosesnya dengan systemd atau pm2 (`pm2 start "bun src/main.ts" --name rta-api`).

**Opsi 3 — Hosting cPanel dengan "Setup Node.js App" (tanpa Bun):**

API dikompilasi ke JavaScript di laptop, lalu dijalankan Node di hosting. Database memakai PostgreSQL dari cPanel (atau Supabase).

1. **Build di laptop:** `bun install && bun run build:api` → hasil di `apps/api/dist/`.
2. **Unggah** ke folder di luar `public_html`, mis. `~/rta-api/`: folder `dist/`, folder `sql/`, dan `package.json` dari `apps/api/`. Jangan unggah `node_modules`, `.env` lokal, `dev/`, `test/`, atau `storage/`.
3. **Database:** cPanel → *PostgreSQL Database Wizard* → buat database & user, beri semua hak. `DATABASE_URL=postgres://<user>:<password>@localhost:5432/<database>` (nama memakai awalan akun cPanel).
4. **Setup Node.js App → Create Application:**
   - Node.js version **20.x** (atau 22.x), Application mode **Production**.
   - Application root `rta-api`, Startup file `dist/src/main.js`.
   - Application URL: alamat web + `/api` (mis. `rta.domain-anda.id/api`), supaya web dan API satu domain.
   - Environment variables: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `WEB_ORIGIN`, `PUBLIC_WEB_URL`, `COOKIE_SECURE=true`, `BASE_PATH=/api`, `TRUST_PROXY=1`, `DISABLE_SCHEDULER=true`, `STORAGE_DIR=/home/<akun>/rta-storage` (di luar `public_html`).
   - Klik **Run NPM Install**, lalu **Restart**.
5. **Env untuk Terminal & Cron:** env di layar aplikasi tidak terbaca oleh Terminal/Cron. Buat `~/rta-api/.env` berisi nilai yang sama (`chmod 600`), dipakai lewat `node --env-file=.env` (Node 20.6+). Jaga isinya tetap sama dengan layar aplikasi.
6. **Migrasi, seed, akun PJ pertama** (cPanel → Terminal; perintah masuk virtualenv tertera di bagian atas halaman aplikasi Node):
   ```bash
   source ~/nodevenv/rta-api/20/bin/activate && cd ~/rta-api
   node --env-file=.env dist/scripts/migrate.js
   node --env-file=.env dist/src/db/seed.js
   ADMIN_NAME="Nama PJ" ADMIN_EMAIL=pj@domain-anda.id ADMIN_PASSWORD='password-sementara' node --env-file=.env dist/scripts/create-admin.js
   ```
   Ulangi migrasi + seed setiap kali mengunggah versi baru, lalu Restart aplikasi.
7. **Cron Job tiap jam** (cPanel → Cron Jobs, *Once Per Hour*). Menggantikan timer di dalam API yang bisa berhenti saat proses ditidurkan:
   ```
   cd ~/rta-api && ~/nodevenv/rta-api/20/bin/node --env-file=.env dist/scripts/cron.js >> ~/rta-cron.log 2>&1
   ```
8. **Uji:** buka `https://rta.domain-anda.id/api/auth/me` → harus JSON 401 (belum masuk), **bukan 404**. Pesan "check availability ... content type" saat *Run NPM Install* tidak berbahaya (alamat aplikasi berubah dari HTML ke JSON). Passenger meneruskan alamat **lengkap** (`/api/auth/me`) ke API, sehingga `BASE_PATH=/api` wajib diisi; tanpanya hasilnya 404 JSON. Setelah mengubah env, **Restart** aplikasi. Setelah login, cek menu Profil → *Perangkat aktif*: IP harus IP Anda, bukan `127.0.0.1`. Bila salah, sesuaikan `TRUST_PROXY`.

Batas resource hosting (RAM, proses, CPU) dipantau di cPanel → *Resource Usage*; ekspor PDF/Excel besar paling banyak memakan memori.

Env produksi: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `WEB_ORIGIN=https://app.domain-anda.id`, `PUBLIC_WEB_URL=https://app.domain-anda.id`, `BANK_NAME`, `BANK_ACCOUNT`, `BANK_HOLDER`, `STORAGE_DIR`, `COOKIE_SECURE=true`, `PORT`, `TRUST_PROXY` (jumlah proxy di depan API, biasanya `1`), `BASE_PATH` (`/api` hanya di cPanel; kosong di Docker/VPS). Lihat `.env.example`.

**Penyimpanan bukti pembayaran.** Saat ini disimpan di disk (`STORAGE_DIR`). Di Docker, pasang volume agar file tidak hilang saat container dibuat ulang: `docker run -v rta-storage:/data/storage …` (image memakai `STORAGE_DIR=/data/storage`). Platform tanpa disk permanen (mis. sebagian PaaS) perlu adapter Supabase Storage/S3; antarmukanya kecil (`put`/`get` di `apps/api/src/common/storage.service.ts`). Sertakan folder ini dalam backup.

**Tagihan otomatis.** API memeriksa setiap jam dan saat start; tagihan SPP bulan berjalan dibuat sekali (aman bila beberapa instance berjalan, karena dijaga indeks unik). Jalankan minimal satu instance API terus-menerus. Di hosting yang prosesnya bisa ditidurkan (cPanel/Passenger), pakai Cron Job tiap jam yang menjalankan `scripts/cron.js` (SPP + hapus akun 30 hari) dan isi `DISABLE_SCHEDULER=true`.

Platform yang mendukung Bun langsung: Railway, Render, Fly.io (deteksi otomatis dari `bun.lock`). Cek dokumentasi masing-masing untuk versi terbaru.

### Web
```bash
bun run build   # hasil: apps/web/dist (file statis)
```
Hosting statis (Vercel, Netlify, Cloudflare Pages, Nginx). Dua syarat:
1. **Proxy `/api/*` ke API**. Contoh Nginx:
   ```
   location /api/ { proxy_pass http://127.0.0.1:3000/; }
   location / { try_files $uri /index.html; }
   ```
2. Web dan API **satu domain induk** (`app.domain.id` + `api.domain.id`) agar cookie refresh token berjalan.

### Akun PJ pertama
Seed produksi **tidak** membuat akun. Setelah container/API pertama kali jalan (migrasi + seed selesai), buat akun PJ sekali:
```bash
# Docker
docker exec -it -e ADMIN_NAME="Nama PJ" -e ADMIN_EMAIL=pj@domain-anda.id -e ADMIN_PASSWORD='password-sementara' <container> bun scripts/create-admin.ts
# Bun langsung
ADMIN_NAME="Nama PJ" ADMIN_EMAIL=pj@domain-anda.id ADMIN_PASSWORD='password-sementara' bun run db:admin
```
Akun wajib ganti password saat login pertama; akun lain dibuat PJ lewat menu Akun. Pembuatan tercatat di audit (password tidak dicatat). Jangan simpan `ADMIN_PASSWORD` di `.env` atau riwayat shell bersama.

### Checklist sebelum go-live
- [ ] Akun PJ pertama dibuat dengan `db:admin`; tidak ada akun `@rta.local` di database produksi.
- [ ] `COOKIE_SECURE=true`, HTTPS aktif.
- [ ] RLS aktif di semua tabel Supabase.
- [ ] Uji login sebagai ustadzah: tidak bisa melihat cabang lain.
- [ ] Uji ekspor PDF sebagai Manajer: no. WA tersembunyi.
- [ ] Jadwal backup dan uji restore sekali.
- [ ] Rekening yayasan di **menu Pengaturan** (atau `BANK_ACCOUNT` sebagai nilai awal) diisi yang benar dan **dicocokkan dengan dashboard bank** sebelum link tagihan pertama dikirim.
- [ ] `PUBLIC_WEB_URL` mengarah ke domain HTTPS produksi; buka satu link tagihan dari HP untuk uji.
- [ ] Volume/backup untuk `STORAGE_DIR` aktif.
- [ ] Jangan jalankan `db:demo`, `db:seed-dev`, `db:reset`, `db:fresh` di produksi (semua ada di `apps/api/dev/` dan menolak `NODE_ENV=production`).
- [ ] `git status` bersih dari `.env`, folder `storage/`, dan file `*.session.sql` sebelum push.
- [ ] Uji sebagai ustadzah: catat tunai → masuk antrean; verifikasi hanya bisa oleh PJ.

## C. Masalah umum

| Gejala | Penyebab / solusi |
|---|---|
| `bun: command not found` | Buka terminal baru setelah instalasi, atau tambahkan `~/.bun/bin` ke PATH |
| `Env DATABASE_URL belum diisi` | `.env` belum dibuat di `apps/api/` |
| `Export named 'X' not found in module` saat start | Import tipe ditulis tanpa `type`. Ubah ke `import type { X } from '...'` |
| `Cannot find package 'xyz'` | Paket dipakai langsung tapi tidak ada di `package.json` (Bun tidak meng-hoist). `bun add --cwd apps/api xyz` |
| Login berhasil tapi reload langsung keluar | Web dan API beda domain tanpa proxy; cookie tidak terkirim |
| `/api/...` menjawab 404 JSON di cPanel, padahal API jalan | `BASE_PATH=/api` belum diisi (Passenger tidak membuang awalan `/api`). Isi, lalu Restart. Sebaliknya, di Docker/VPS dengan proxy yang membuang `/api`, `BASE_PATH` harus kosong |
| Banyak pengguna mendapat 429 "terlalu banyak permintaan" bersamaan; IP di *Perangkat aktif* selalu `127.0.0.1` / IP server | API di belakang proxy tapi `TRUST_PROXY` belum diisi. Isi jumlah proxy di depan API (biasanya `1`), lalu restart |
| `Akun dikunci sementara` | 5x salah password. PJ/Admin: menu Akun → *Buka kunci* |
| Impor gagal semua | Lihat daftar baris bermasalah; tanggal `YYYY-MM-DD`, no. WA diawali 08/+62 |
| Link tagihan wali "tidak berlaku" | Link berlaku 30 hari dan dicabut saat link baru dibuat untuk keluarga yang sama; kirim ulang dari menu Bayar |
| Tagihan SPP bulan ini belum muncul | API belum berjalan sejak tanggal 1, atau `DISABLE_SCHEDULER=true`. PJ bisa memicu manual: `POST /spp/generate` |
| Unggah bukti ditolak | Format harus JPG/PNG/WebP/PDF ≤ 5 MB; file diperiksa dari isinya, bukan ekstensinya |

## Deploy otomatis ke VPS + Cloudflare (Makefile)

Docker + Caddy di VPS (TLS otomatis), DNS & SSL diatur lewat API Cloudflare. File: `Makefile`, `deploy/`.

```bash
cp deploy/deploy.example.env deploy/deploy.local.env   # isi VPS_HOST, DOMAIN, CF_ZONE_ID, CF_API_TOKEN
make first-deploy   # setup VPS → config rahasia → DNS → SSL strict → deploy → IP Cloudflare → cek
make admin          # akun PJ pertama
```
Rutin: `git commit` lalu `make deploy` · `make logs S=api` · `make backup` (db + bukti bayar → `./backups/`, data pribadi, simpan aman) · `make help`.
Yang dikirim adalah commit terakhir (`git archive HEAD`). Rahasia server ada di `/opt/rta/config/` (tidak masuk git). Token Cloudflare cukup izin Zone.DNS:Edit + Zone.Zone Settings:Edit pada satu zone.
