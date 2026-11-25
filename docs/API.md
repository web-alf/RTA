# API — ringkasan endpoint

Base URL dev: `http://localhost:3000` (dari web lewat proxy `/api`). Semua endpoint kecuali `auth/login|refresh|logout` dan `public/*` butuh header `Authorization: Bearer <accessToken>`. Permission ditulis dalam kurung.

Error seragam: `{ "message": "...", "details": ["..."]? }`. 401 = sesi berakhir, 403 = tidak punya akses, 404 = tidak ditemukan / di luar scope, 423 = akun terkunci.

## Auth
| Method | Path | Keterangan |
|---|---|---|
| POST | `/auth/login` | `{email,password}` → `{user, accessToken}` + cookie `rta_refresh` (httpOnly). Batas 10/menit per IP |
| POST | `/auth/refresh` | Rotasi refresh token dari cookie → token akses baru |
| POST | `/auth/logout` | Cabut refresh token |
| GET | `/auth/me` | Data pengguna, role, perms, branchIds (`null` = semua) |
| POST | `/auth/change-password` | `{oldPassword,newPassword}` |
| GET / PATCH | `/auth/profile` | Profil (role, cabang, santri diampu) / ubah `{name?, phone?}` |
| PATCH | `/auth/prefs` | `{notifHafalan?, notifBukti?, notifPengajuan?, textSize?: normal|besar}` |
| GET | `/auth/sessions` | Perangkat yang sedang masuk (`current` = perangkat ini) |
| POST | `/auth/sessions/:id/revoke` | Keluarkan satu perangkat |
| POST | `/auth/logout-all` | Keluar dari semua perangkat |

## Master
| GET | `/branches?semua=1` | Cabang + kelas sesuai scope; `semua=1` = semua cabang (pilihan tujuan mutasi) |
|---|---|---|
| GET | `/classes` (kelas.lihat) | Kelas + jumlah santri aktif/cuti/indent |
| GET | `/status-reasons` | Alasan cuti/keluar |

## Santri (santri.*)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/students?q&branchId&classId&status&page&size` | Daftar (paginasi server). Tiap baris = kolom spreadsheet data santri: `nis, fullName, gender, birthPlace, birthDate, branchName, level, className, joinDate, status, registrationNote, subsidyLabel, fatherName, motherName, waPhone, address, fatherJob, motherJob`. Kontak/alamat/pekerjaan dimasking untuk role non-sensitif; `subsidyLabel` tidak dikirim sama sekali ke role itu. `counts` = jumlah per status (`""` = semua, `AKTIF`, `CUTI`, `INDENT`, `KELUAR`) sesuai scope, cabang, kelas, dan pencarian, tanpa filter status |
| GET | `/students/:id` | Detail + keluarga + riwayat status/penempatan + pengajuan + saudara |
| POST | `/students` | Tambah. `familyId` **atau** `family{...}`. Opsional `registrationNote` (keterangan pendaftaran), `subsidyId` (kategori dari `/subsidies`, hanya PJ/`spp.input`; tarif SPP ikut kategori, ditolak bila tidak berlaku di cabang). ID santri otomatis `RTA-<kode cabang>-<urut>` (mis. `RTA-GNK-001`, tetap saat mutasi), snapshot `sppRate`. Pencarian `q` juga mencocokkan ID format lama |
| PATCH | `/students/:id` | Edit (`fullName, nickname, gender, birthPlace, birthDate, school, healthNotes, registrationNote`); `classId`, `sppRate`, `subsidyId` hanya PJ. `subsidyId: null` = cabut (tarif kembali standar cabang). `sppRate` manual hanya untuk santri tanpa subsidi. Detail memuat `subsidyId`, `subsidySince` (tidak dikirim ke role non-sensitif) |
| POST | `/students/:id/status` | `{action: CUTI|AKTIF|MULAI, effectiveDate, reason?, note?}` → `{status, subsidiDicabut}` (jumlah santri yang diskon saudaranya dicabut otomatis). `PATCH /students/:id` juga mengembalikan `saudaraIkut` & `subsidiDicabut` saat subsidi berubah |
| POST | `/students/:id/requests` (pengajuan.input) | `{type: KELUAR|MUTASI, effectiveDate, reason, targetBranchId?, targetClassId?, note?}` |

## Pengajuan (pengajuan.*)
| GET | `/requests?state=MENUNGGU|DISETUJUI|DITOLAK|DITARIK` | Daftar sesuai scope (cabang asal tersimpan) |
|---|---|---|
| GET | `/requests/:id` | Detail tinjau: dari/ke, tarif, cek tunggakan & kelas, biaya pindah |
| POST | `/requests/:id/withdraw` (input) | Tarik pengajuan (pengaju atau PJ) |
| POST | `/requests/:id/approve` (setujui) | `{note?}` → terapkan keluar/mutasi; mutasi menagih biaya pindah (sekali per tahun pembelajaran) |
| POST | `/requests/:id/reject` (setujui) | `{note}` wajib |

## Keluarga / wali (wali.*)
| GET | `/families?q` | Keluarga yang punya santri dalam scope |
|---|---|---|
| GET | `/families/lookup?phone=` | Cek no. WA: `{found, inScope, family?|message}` |
| GET | `/families/:id` | Detail + daftar santri (`branchName`; untuk PJ & ustadzah juga `subsidyId`, `subsidyLabel`, `sppRate`, tidak dikirim ke Manajer) |
| POST | `/families` | Buat |
| PATCH | `/families/:id` | Ubah |

## Pengguna
| GET | `/users?q&role` (akun.lihat) | Semua akun + penugasan; `deleteAfter`/`deleteReason` terisi bila di daftar hapus. Akun yang sudah dihapus permanen tidak tampil |
|---|---|---|
| GET | `/users/ustadzah` (ustadzah.lihat) | Hanya role USTADZAH |
| POST | `/users` (akun.input) | `{name,email,password,roleCode,phone?,familyId?,branchIds?}`; `familyId` wajib bila `roleCode = WALI`; `branchIds` (≥ 1 cabang aktif) wajib bila `roleCode = USTADZAH`, penugasan berlaku mulai hari ini |
| PATCH | `/users/:id` (akun.edit) | `{name?,phone?,roleCode?,isActive?}`; role WALI tidak bisa ditukar ke/dari role staf |
| POST | `/users/:id/reset-password` | → `{temporaryPassword}` |
| POST | `/users/:id/unlock` | Buka kunci login |
| POST | `/users/:id/hapus` (akun.edit, **role PJ saja**) | `{reason}` → `{deleteAfter}`. Akun langsung nonaktif, sesi dicabut, masuk daftar hapus 30 hari. Tidak bisa menghapus akun sendiri / PJ aktif terakhir. Selama di daftar hapus, PATCH/reset/buka kunci/penugasan ditolak 400 |
| POST | `/users/:id/batal-hapus` (akun.edit, **role PJ saja**) | Batalkan selama masa tunggu; akun aktif kembali. 404 bila tidak di daftar hapus |
| POST | `/users/:id/branches` (ustadzah.edit) | `{branchId,startDate,endDate?}` |
| DELETE | `/users/:id/branches/:ubId` | Hapus penugasan |

## Role, dashboard, audit, impor/ekspor
| GET | `/roles` (role.lihat) | `{menus, actions, roles[{..., perms[]}]}` |
|---|---|---|
| PUT | `/roles/:id/perms` (role.edit) | `{perms: string[]}` |
| GET | `/dashboard?branchId&month=YYYY-MM` | Ringkasan (scope cabang: ustadzah hanya cabangnya). `santri.putra/putri` = santri Aktif per jenis kelamin; `tindakan.requests` (pengajuan MENUNGGU, maks. 3 per jenis, butuh `pengajuan.lihat`), `tindakan.payments` (bukti bayar MENUNGGU, maks. 3, butuh `bayar.lihat`, tanpa nominal/kontak), `tindakan.count.{mutasi,keluar,bukti}` (null bila tanpa izin). `keuangan.lunasSantri/totalSantri` = tagihan **SPP** bulan ini. `finance` (kotak Keuangan, null bila tanpa izin ketiganya; filter `branchId` ikut): `label`, `spp{tagihan, terbayar, menunggu, belum, tunggakan, keluargaTunggakan, lunas, total}` (= `/spp/summary`, butuh `spp.lihat`), `pendaftaran{santri, target, terkumpul, menunggu, belum, lunas, cicilan, belumBayar, buktiDiperiksa, jatuhTempo{n, amount} (7 hari ke depan), terlambat{n, first{name, days}}}` (= `/registrations`, butuh `pendaftaran.lihat`), `kas{masuk, keluar, selisih, menunggu, menungguNominal, belumDibayar, keluarTerbesar[maks. 3]}` (= `/kas`, butuh `kas.lihat`). Tanpa label subsidi |
| GET | `/audit?entity&entityId` (audit.lihat) | 200 catatan terakhir |
| GET | `/export/students.pdf?branchId&status` (santri.ekspor) | PDF A4 mendatar, kolom = spreadsheet data santri (kolom sensitif hanya untuk PJ/ustadzah), dicatat di `export_logs` |
| GET | `/import/students/template?format=xlsx` (santri.impor) | Template CSV (default) atau Excel `.xlsx` (`format=xlsx`; kolom tanggal & no. WA berformat teks), header = spreadsheet data santri (`ID Santri … Pekerjaan Ibu`). **Wajib**: ID Santri, Nama Lengkap, Jenis Kelamin, Cabang, Jenjang, Status, Keterangan Pendaftaran; kolom lain boleh kosong (disimpan NULL, migrasi 015/016). Tanggal Bergabung kosong = santri lama: `joinDate: null`, tetap ikut SPP bulanan (bila Aktif) & absensi, tanpa tagihan PENDAFTARAN, tidak muncul di `/registrations`, riwayat penempatan/status bertanggal hari impor tapi bila diisi formatnya harus benar. ID Santri dipakai sebagai ID resmi: format `RTA-<kode cabang>-<nomor ≥3 digit>` (huruf kecil/spasi dinormalkan), kode cabang terdaftar (boleh berbeda dari cabang sekarang = cabang pendaftaran), tidak ganda di file maupun database; ID otomatis berikutnya melanjutkan nomor terbesar. Tanpa No WA Wali: keluarga baru sendiri (tidak dicocokkan dengan saudara) dan `POST /bayar/families/:id/link` ditolak 400 sampai nomornya diisi. Tanpa Tanggal Lahir: santri ganda dicocokkan nama + cabang (bukan nama + tanggal lahir); tanggal `YYYY-MM-DD` atau `DD/MM/YYYY`; Jenis Kelamin `L/P/Laki-laki/Perempuan`; Jenjang `JUZ30`/`Juz 30`; Kategori Subsidi hanya boleh diisi PJ (nama kategori; kosong / `Reguler` / `Tanpa subsidi` / `-` = tanpa subsidi); Status `INDENT/AKTIF/CUTI/KELUAR`. Header template lama (`jk, tgl_lahir, tgl_masuk, no_wa`) masih diterima |
| POST | `/import/students?dryRun=true|false` | multipart `file` (CSV atau `.xlsx` ≤ 2 MB, maks. 2.000 baris; format dikenali dari isi file, `.xls` lama ditolak). xlsx: sheet pertama, sel tanggal & no. WA yang tersimpan sebagai angka dikenali, nomor baris error = baris di Excel. Validasi format seluruh file, lalu simpan dalam **satu transaksi** (savepoint per baris; semua error dikumpulkan dengan nomor barisnya). `dryRun=true` menjalankan penyimpanan yang sama lalu rollback, jadi aturan database (santri ganda, no. WA keluarga di luar scope, syarat diskon saudara) ikut diperiksa. Satu baris gagal → tidak ada yang tersimpan (`{ok:false, errors}`). Diskon saudara dipasang setelah semua baris masuk, sehingga dua saudara dalam satu file sama-sama bisa berkategori Saudara. Kategori subsidi diikuti apa adanya: Reguler/kosong tetap Reguler, diskon saudara dipasang tanpa syarat saudara Aktif dan tanpa mengubah saudara lain |

## Kelas & hafalan (kelas.*)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/hafalan/surahs?level=JUZ30|JUZ29|JUZ28` | Referensi surah (urutan hafalan, jumlah ayat) |
| GET | `/hafalan/classes` | Kelas dalam scope + rata-rata capaian + jumlah diinput pekan ini |
| GET | `/hafalan/classes/:id` | Roster: posisi terakhir, `week` (SUDAH/BELUM/TETAP/CUTI), `delta`, `trend` 4 pekan, ringkasan |
| GET | `/hafalan/students/:id` | 12 catatan terakhir |
| POST | `/hafalan/records` (input) | `{studentId, surahId, ayat, confirmLower?}` → `{total, percent, delta}`. 400 bila ayat di luar batas; 409 `LOWER` bila posisi turun tanpa konfirmasi |

## SPP (spp.*) dan Bayar (bayar.*)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/spp/summary?month=YYYY-MM&branchId` | Jumlah per status, uang, lunas per cabang |
| GET | `/spp/export.xlsx` · `/spp/export.pdf` `?month=&branchId=` (spp.ekspor; PJ, Manajer) | Laporan SPP: rekap per santri bulan itu (tanpa label subsidi), pembayaran SPP & daftar ulang bulan itu, daftar ulang tahun berjalan. Dicatat di `export_logs` |
| GET | `/spp/students?month&q&branchId` | Per santri: status bulan ini (Tunggakan bila ada bulan lalu belum lunas), `hist` 6 bulan, `sisa` |
| GET | `/spp/students/:id/invoices` | Tagihan satu santri |
| POST | `/spp/generate?month=YYYY-MM` (spp.input) | Buat SPP bulan itu, sama dengan penjadwal tanggal 1 (idempotent; otomatis tiap jam). Kosong = bulan berjalan (WIB); format salah atau lebih dari satu bulan ke depan → 400. Tercatat di audit (`generate`/`invoice`) → `{created, period}` |
| POST | `/spp/generate-reregistration` (spp.input) | Daftar ulang untuk santri Aktif & Cuti (tidak ganda) |
| GET | `/bayar/families?q` | Keluarga dengan tagihan terbuka: total, status, terakhir dikirim, bukti menunggu |
| GET | `/bayar/families/:id/invoices?terjadwal=1` | Tagihan terbuka satu keluarga (`dueDate` untuk cicilan). `terjadwal=1` ikut cicilan yang belum jatuh tempo (catat bayar / lunasi lebih awal); tanpa itu hanya yang jatuh tempo (dipakai pesan WA) |
| POST | `/bayar/families/:id/link` (input) | Link bertoken 30 hari + teks pesan + `waUrl` (wa.me); link lama dicabut |
| POST | `/bayar/payments` (input) | multipart: `familyId, invoiceIds (koma), amount (= total), paidAt, method TRANSFER|TUNAI, matched?, note?, file?` (bukti wajib untuk transfer). Terverifikasi langsung hanya bila pencatat punya `bayar.setujui` dan `matched=true` |
| GET | `/bayar/payments?state=MENUNGGU|TERVERIFIKASI|DIBATALKAN` | Daftar sesuai scope |
| POST | `/bayar/payments/:id/verify` (setujui) | Verifikasi |
| POST | `/bayar/payments/:id/cancel` (setujui) | `{reason}` wajib; tolak (menunggu) atau batalkan (terverifikasi). Tidak dihapus |
| GET | `/bayar/payments/:id/proof` | File bukti (dengan cek scope) |

## Publik (tanpa login, dibatasi laju per IP)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/public/tagihan/:token` | Nama panggilan, label tagihan, nominal, total, `banks[{name, account, holder, branches[], total}]` (rekening cabang dari tagihan yang perlu dibayar; >1 bila anak beda cabang; `bank` = yang pertama). Tanpa data sensitif. 30/menit |
| POST | `/public/tagihan/:token/bukti` | multipart `file` → pembayaran MENUNGGU untuk semua tagihan terbuka. 5/menit |

## Portal wali (portal.*, khusus akun role WALI)
Scope = keluarga akun (`users.family_id`); data minimum, tanpa kontak/alamat/kesehatan/label subsidi.

| Method | Path | Keterangan |
|---|---|---|
| GET | `/portal` (portal.lihat) | `{kids, tagihan: {bills,total,waiting,bank}, lps: [{id,who,period,label,hafalanPercent,publishedAt}]}` |
| GET | `/portal/perkembangan` (portal.lihat) | Progres tahun pembelajaran berjalan: `{yearStart, yearLabel, kids: [{id, fullName, nickname, status, className, level, current: {percent,surah,ayat,weekStart}\|null, startPercent, weeks: [{weekStart,level,surah,ayat,percent}], surahs: [{name,ayatCount,state: SELESAI\|BERJALAN\|BELUM, ayat}], lps: [{period,label,hafalanPercent,scores}]}]}`. `weeks` = posisi terakhir per pekan sejak awal tahun; `lps` hanya yang TERBIT, tanpa catatan |
| POST | `/portal/bukti` (portal.input) | multipart `file` → pembayaran MENUNGGU untuk semua tagihan terbuka keluarga. 5/menit |
| GET | `/portal/lps/:id/pdf` (portal.lihat) | PDF LPS **terbit** milik anak di keluarga itu; selain itu 404 |

## LPS (lps.*)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/lps?period=YYYY-MM&status&q&branchId` | Santri aktif + status LPS (`BELUM` = belum dibuat), ringkasan, distribusi per aspek, per cabang |
| POST | `/lps/generate` (input) | `{period, classId?}` buat draft; hafalan ditarik otomatis |
| PATCH | `/lps/:id` (edit) | `{scores: {BTQ, Tahsin, Adab, "Doa harian"}, note}` hanya saat Draft |
| POST | `/lps/:id/submit` (edit) · `/approve` · `/publish` (setujui) | Alur status |
| POST | `/lps/:id/revise` (setujui) | `{note}` kembalikan ke Draft |
| GET | `/lps/:id/pdf` | PDF (ustadzah: hanya yang Terbit) |

## Pengaturan (pengaturan.*)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/settings` (lihat: PJ, ustadzah, Manajer) | `{values, defaults, placeholders, branches[{id, code, name, sppStandard, registrationFee, santri, santriTarifStandar}], banks[{branchId, branchName, name, account, holder, isDefault}], updatedAt, updatedBy}`. `branches` & `banks` di-scope ke cabang pengguna (ustadzah hanya cabangnya). `isDefault` = cabang belum mengisi rekening sendiri (memakai rekening bawaan yayasan) |
| PATCH | `/settings` (edit: PJ) | Sebagian dari `{reregistrationFee, academicYearStartMonth (1–12), linkDays (1–90), registrationMinDp, registrationMaxInstallments, waTemplate}`. Template wajib memuat `{link}`, maks. 5 baris, hanya `{tagihan}` `{nama}` `{total}` `{link}`. Audit nilai lama & baru |
| PATCH | `/settings/branches/:id/bank` (input: PJ semua cabang, ustadzah cabangnya; di luar scope 404) | `{bankName, bankAccount (angka/spasi/titik/strip, 4–40), bankHolder}` → `{changed}`. Audit `ubah_rekening` (entity `branch`) |
| PATCH | `/settings/branches/:id` (edit) | `{sppStandard, registrationFee, applyToStudents?}`. Tagihan terbit tidak berubah; `applyToStudents` ikut mengubah `spp_rate` santri (bukan Keluar) yang masih = tarif standar lama → `{santriDiubah}` |

## Subsidi (master tarif, prd.md 8.2)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/subsidies` (`spp.input`: PJ) | `[{id, name, kind: TARIF|DISKON, percent, isSibling, isActive, rates[{branchId, available, amount, note}], holders[{branchId, n}]}]`. `amount` = tarif SPP hasil (DISKON dihitung dari tarif standar cabang). Label rahasia: Manajer & ustadzah 403 |
| POST | `/subsidies` (`pengaturan.edit`) | `{name, kind, percent? (DISKON), isSibling?, rates[{branchId, available, amount? (TARIF), note?}]}` |
| PATCH | `/subsidies/:id` (`pengaturan.edit`) | Sama + `isActive?`, `applyToStudents?` → `{santriDiubah}`. Ditolak bila mencabut cabang / menonaktifkan kategori yang masih dipakai santri, atau mengganti tipe yang sedang dipakai. Ganti nama ikut mengganti label santri. Audit nilai lama & baru |

Otomatis: memasang **diskon saudara** pada santri Aktif (tambah santri, edit; **bukan** impor) ikut memasangnya ke saudara Aktif yang masih Reguler (`saudaraIkut` di respons `POST`/`PATCH /students`; audit `subsidi_dipasang_otomatis`). **Diskon saudara** (`isSibling`) dicabut dari semua pemegang di satu keluarga bila pemegang yang Aktif tinggal < 2 (saat ubah status & persetujuan pengajuan); **mutasi** menghitung ulang tarif di cabang tujuan dan mencabut subsidi yang tidak berlaku di sana. Keduanya tercatat di audit (`subsidi_dicabut_otomatis`).

## Pendaftaran (pendaftaran.*)
Tagihan pendaftaran santri yang bergabung di tahun pembelajaran berjalan (bulan mulai dari Pengaturan). Satu cicilan = satu tagihan `PENDAFTARAN` (`installment_no/total`, `due_date`), jadi pembayaran tetap lewat `POST /bayar/payments` dengan nominal = tagihan yang dipilih.
| Method | Path | Keterangan |
|---|---|---|
| GET | `/registrations` (lihat; PJ, ustadzah cabangnya, Manajer) | `{yearStart, minDp, maxInstallments, summary{total, lunas, cicilan, terlambat, belumBayar, menunggu, target, terkumpul, diperiksa}, rows[{studentId, fullName, branchName, className, familyId, familyName, scheme: BELUM_DIATUR|LUNAS|CICIL, count, fee, paid, pending, sisa, paidCount, status: TERLAMBAT|BELUM_BAYAR|MENUNGGU|CICILAN|LUNAS, next, installments[{id, no, label, amount, dueDate, status, paidAt, method}]}]}` |
| GET | `/registrations/export.xlsx` · `/registrations/export.pdf` (ekspor; PJ, Manajer) | Laporan pendaftaran tahun pembelajaran berjalan: per santri (skema, biaya, terbayar, sisa, status, berikutnya) + jadwal cicilan. Scope cabang; dicatat di `export_logs` |
| POST | `/registrations/:studentId/plan` (edit; PJ) | `{scheme: LUNAS}` atau `{scheme: CICIL, count, dp, dueDates?}`. Cicil: 2..`registrationMaxInstallments` kali termasuk DP, DP ≥ `registrationMinDp` dan < biaya, sisa dibagi rata kelipatan Rp1.000 (terakhir menyerap selisih), jatuh tempo bawaan per bulan dari hari ini (tanggal sama / akhir bulan), tiap cicilan beda bulan. Tagihan lama di-void (tidak dihapus). Ditolak bila sudah ada pembayaran (terverifikasi/menunggu). Audit `atur_skema_pendaftaran` → `{scheme, invoices[{id, no, amount, dueDate}]}` |

Status tagihan berjatuh tempo: **TUNGGAKAN** bila lewat `due_date` (per hari), **TERJADWAL** bila jatuh temponya bulan depan atau setelahnya (tidak tampil di daftar tagihan/pesan WA/halaman wali, bisa dilunasi lebih awal).

## Kas (kas.*)
**Pembukuan terpisah:** Kas = penjualan barang (tunai/transfer + tagihan barang yang sudah dibayar & diverifikasi) − pengeluaran **disetujui**. Uang SPP & daftar ulang dibukukan di menu SPP, uang pendaftaran di menu Pendaftaran. Semua di-scope ke cabang pengguna. Stok = `SUM(stock_moves.delta)` per barang per cabang.
| Method | Path | Keterangan |
|---|---|---|
| GET | `/kas?month=YYYY-MM&branchId=` (lihat; PJ, ustadzah, Manajer) | `{month, label, summary{masuk, keluar, selisih, penjualan, belumDibayar, menunggu, menungguNominal}, chart[6 bulan {month, label, masuk, keluar}], categories{masuk[per kategori barang], keluar[per kategori pengeluaran]}, unpaid[tagihan barang terbuka], transactions[]}`. Transaksi: pelunasan tagihan barang (`kind: MASUK`, `auto`), penjualan (`kind: JUAL`), pengeluaran (`kind: KELUAR`, termasuk yang MENUNGGU dari bulan mana pun); `counted` = ikut dihitung |
| GET | `/kas/export.xlsx` · `/kas/export.pdf` `?month=&branchId=` (ekspor; PJ, Manajer) | Laporan kas bulan itu: transaksi, per kategori, barang belum dibayar, stok per cabang. Dicatat di `export_logs` |
| GET | `/kas/catalog?branchId=` (lihat) | `{branches, itemCategories[{id, name, icon, isActive, items[{id, name, price, lowStock, isActive, stock, stocks[{branchId, branchName, qty}]}]}], expenseCategories[{id, name, isActive, used}], icons}` |
| POST/PATCH | `/kas/item-categories[/:id]` (edit; PJ) | `{name, icon: BOOK|SHIRT|STAR|BOX, isActive?}`. Nama unik. Nonaktif = tidak muncul di pilihan (tidak dihapus) |
| POST/PATCH | `/kas/items[/:id]` (edit) | `{categoryId, name, price, lowStock?, isActive?}`. Harga baru hanya untuk penjualan berikutnya |
| POST | `/kas/items/:id/stock` (edit) | `{branchId, delta (≠0), note}` stok awal/koreksi; tidak boleh minus · GET (lihat) = riwayat 50 terakhir |
| POST/PATCH | `/kas/expense-categories[/:id]` (edit) | `{name, isActive?}` |
| GET | `/kas/students?q=` (input) | Santri (bukan Keluar) di scope untuk dipilih saat jual |
| POST | `/kas/sales` (input; multipart) | `studentId, method: TUNAI|TRANSFER|TAGIHAN, items: JSON [{itemId, qty}], soldAt?, file` (TRANSFER wajib bukti). Harga & stok dari server (stok cabang santri, dikunci per cabang). TAGIHAN → tagihan `BARANG` (menu Bayar, pesan WA, halaman wali). Audit `jual_barang` |
| POST | `/kas/sales/:id/cancel` (setujui; PJ) | `{reason}`. Stok kembali, tagihan barang di-void; ditolak bila tagihannya sudah dibayar/menunggu |
| GET | `/kas/students/:id/sales` (lihat) | Tab Pembelian: `{rows, totalYear, unpaid}` |
| POST | `/kas/expenses` (input; multipart) | `branchId (ustadzah: cabangnya), categoryId, amount, description, spentAt, method: TUNAI|TRANSFER, restock?: JSON [{itemId, qty}], file?` (nota). Tanpa `kas.setujui` → MENUNGGU; PJ → langsung DISETUJUI |
| POST | `/kas/expenses/:id/approve` (setujui) | MENUNGGU → DISETUJUI, restock menambah stok |
| POST | `/kas/expenses/:id/decline` (setujui) | `{reason}`. MENUNGGU → DITOLAK; DISETUJUI → DIBATALKAN (stok restock ditarik; ditolak bila sudah terjual) |
| GET | `/kas/sales/:id/proof`, `/kas/expenses/:id/proof` (lihat) | File bukti/nota (scope dicek) |

## Agenda (agenda.*)
Agenda dengan `branchId: null` berlaku untuk semua cabang. Staf bercabang (ustadzah) melihat agenda umum + agenda cabangnya; agenda cabang lain dijawab 404. Default izin: PJ `lihat/input/edit`, Ustadzah & Manajer `lihat`.

| Metode | Path | Keterangan |
|---|---|---|
| GET | `/agenda?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId=&includeCancelled=1` (lihat) | `{from, to, rows[{id, title, category, startDate, endDate, startTime, endTime, location, note, branchId, branchName, createdBy, createdAt, updatedAt, cancelledAt, cancelReason}]}`. Bawaan: bulan berjalan (WIB), tanpa agenda batal. Rentang maksimal ±400 hari. `branchId` = agenda cabang itu + agenda umum |
| GET | `/agenda/:id` (lihat) | Detail; di luar scope → 404 |
| POST | `/agenda` (input) | `{title (3–120), category: KEGIATAN|LIBUR|UJIAN|RAPAT|LAINNYA, startDate, endDate?, startTime? "HH:MM", endTime?, branchId? (null = semua cabang), location?, note?}` → `{id}`. Selesai tidak boleh sebelum mulai; jam selesai butuh jam mulai |
| PATCH | `/agenda/:id` (edit) | Body sama dengan POST (ganti penuh). Agenda batal tidak bisa diubah |
| POST | `/agenda/:id/cancel` (edit) | `{reason}` wajib. Tidak dihapus: `cancelledAt` + alasan tersimpan |

Semua perubahan tercatat di audit (`entity=agenda`, aksi `create|update|cancel`, nilai lama & baru).

## Absensi (absensi.*)
Kehadiran harian per kelas: `H` hadir, `I` izin, `S` sakit, `A` alpa. Scope cabang berlaku di semua endpoint (kelas/santri di luar scope → 404). Hari belajar = `attendanceDays` di Pengaturan (bawaan Senin–Jumat); libur dari Agenda kategori `LIBUR` (umum + cabang kelas). Default izin: PJ & Ustadzah `lihat/input/ekspor` (ustadzah hanya cabangnya), Manajer `lihat/ekspor`.

| Metode | Path | Keterangan |
|---|---|---|
| GET | `/absensi/classes` (lihat) | Kelas dalam scope: `{id, name, level, branchId, branchName, aktif, cuti, doneToday, today, schoolDay, holiday}` |
| GET | `/absensi/day?classId=&date=YYYY-MM-DD` (lihat) | `{class, date, today, kind: BELAJAR|LIBUR|NANTI, holiday, editable, rows[{id, nis, fullName, nickname, status: AKTIF|CUTI|PINDAH, attendance, note}], summary{aktif, filled, H, I, S, A, cuti}, lastSaved}`. Bawaan: hari ini (WIB). `note` dimasking untuk role non-sensitif |
| PUT | `/absensi/day` (input) | `{classId, date, entries[{studentId, status: H|I|S|A, note? (≤200, hanya disimpan untuk I/S)}]}` → `{changed, summary}`. Upsert per santri per tanggal (tidak dihapus). Ditolak: tanggal belum lewat, hari libur/bukan hari belajar, santri cuti/bukan anggota kelas. Tercatat di audit (`entity=class`, aksi `absensi`, nilai lama & baru) |
| GET | `/absensi/recap?classId=&month=YYYY-MM` (lihat) | `{class, month, label, days[{date, day, dow, kind, holiday}], meetings, rules, rows[{id, fullName, status, cells[H|I|S|A|BELUM|CUTI|null], counts, meetings, percent, alpaStreak, attention[]}], summary}`. Diurutkan dari kehadiran terendah. % = hadir ÷ (H+I+S+A) |
| GET | `/absensi/per-class?month=&branchId=` (lihat) | `[{classId, name, branchName, hadir, total, percent}]` |
| GET | `/absensi/students/:id?month=` (lihat) | Kalender satu santri + statistik. `wa{message, waUrl}` hanya untuk PJ/ustadzah (`absensi.input`) bila ada alpa bulan itu; pesan dari template `attendanceWaTemplate` |
| POST | `/absensi/students/:id/wa` (input) | Mencatat penggunaan tombol *Kabari wali* di audit (tanpa isi pesan) |
| GET | `/absensi/export.xlsx` · `/absensi/export.pdf` `?classId=&month=` (ekspor) | Rekap bulanan (ringkasan + harian). Tercatat di `export_logs` |

## Permission
Format `<menu>.<aksi>`; menu: dashboard, spp, bayar, lps, kelas, santri, ustadzah, wali, pengajuan, role, akun, audit, pengaturan, agenda, pendaftaran, kas, absensi, portal; aksi: lihat, input, edit, ekspor, impor, setujui. Matriks default: `apps/api/src/common/permissions.ts`.
