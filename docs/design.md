# DESIGN.md — Sistem Desain Dashboard RTA

| | |
|---|---|
| **Versi** | 0.1 |
| **Warna merek** | `#ad1d8e` (magenta keunguan) |
| **Pengguna utama** | Ustadzah (sering di HP), PJ RTA, Manajer, Admin Sistem. Wali santri hanya memakai satu halaman publik di HP |
| **Pasangan dokumen** | `prd.md` |

---

## 1. Arah desain

**Alat kerja yang tenang dan jelas.** Dashboard ini dipakai berulang untuk mencatat, memeriksa, dan memverifikasi. Antarmuka harus cepat dipindai, hemat ketukan, dan tidak melelahkan mata. Wajah "modern" datang dari ruang kosong, tipografi yang rapi, dan satu keputusan warna yang tegas, bukan dari dekorasi.

**Satu hal yang diingat: sidebar plum gelap.** Sidebar memakai turunan tergelap dari warna merek (`#2d0b26`) dan item aktif berupa pil magenta `#ad1d8e`. Area kerja tetap putih dan netral. Dengan begitu merek terasa kuat tanpa mewarnai seluruh layar, dan magenta cukup langka di area kerja sehingga tetap berarti: ia hanya muncul pada tindakan utama, item aktif, fokus, dan hal yang butuh perhatian.

**Prinsip**

1. **Magenta berarti "tindakan atau perhatian".** Kurang dari 10% permukaan area kerja. Bukan untuk status error (error memakai merah).
2. **Garis dan ruang sebelum kotak dan bayangan.** Pemisah tipis dan jarak yang konsisten menggantikan kartu bertumpuk.
3. **Status tidak hanya warna.** Selalu ikon atau teks bersama warna.
4. **Mobile-first untuk alur ustadzah:** target sentuh besar, tombol aksi utama di bawah layar, formulir bertahap.
5. **Bahasa Indonesia yang lugas.** Kalimat biasa, kata kerja jelas, nama aksi yang sama di seluruh alur.

**Yang sengaja dihindari** (tanda tampilan generik): deretan kartu identik berisi angka besar dengan latar gradien; label huruf kapital berjarak di atas setiap judul; satu radius sudut untuk semua; bayangan abu-abu yang sama di semua elemen; animasi masuk di setiap bagian; tanda panah `→` yang ditempel di semua tombol.

## 2. Warna

### 2.1 Skala merek

Dihasilkan dari rona `#ad1d8e` (rona ±313°). Angka 600 adalah warna merek asli.

| Token | Hex | Pemakaian | Kontras dengan putih |
|---|---|---|---|
| `brand-50` | `#fdf2fa` | Latar tint, hover baris tabel | 1,09 |
| `brand-100` | `#fae1f4` | Latar badge/aksen lembut | 1,23 |
| `brand-200` | `#f4c3e9` | Garis aksen lembut | 1,52 |
| `brand-300` | `#ea99d9` | Teks sekunder di atas plum gelap | 2,09 |
| `brand-400` | `#e05cc4` | Aksen di mode gelap | 3,23 |
| `brand-500` | `#d926b2` | Hover terang (jangan untuk teks kecil) | 4,31 |
| **`brand-600`** | **`#ad1d8e`** | **Tombol utama, item aktif, tautan, fokus** | **6,28** |
| `brand-700` | `#8e1574` | Hover/pressed tombol utama, teks di atas tint | 8,37 |
| `brand-800` | `#6e125a` | Teks pada `brand-100` | 11,07 |
| `brand-900` | `#4d0f40` | Aksen sangat gelap | 14,40 |
| `brand-950` | `#2d0b26` | **Latar sidebar** | 17,69 |

### 2.2 Netral (sedikit condong ke rona merek)

| Token | Hex | Pemakaian | Kontras dengan putih |
|---|---|---|---|
| `neutral-0` | `#ffffff` | Latar area kerja, panel | — |
| `neutral-50` | `#f9f8f9` | Latar halaman, latar input | 1,06 |
| `neutral-100` | `#f4f1f3` | Latar header tabel, chip | 1,12 |
| `neutral-200` | `#e8e3e7` | Pemisah halus | 1,27 |
| `neutral-300` | `#d6cdd4` | Garis kartu/tabel | 1,55 |
| `neutral-400` | `#af9dab` | Ikon nonaktif | 2,55 |
| `neutral-500` | `#8c7387` | Batas input, ikon sekunder | 4,27 |
| `neutral-600` | `#6b5766` | **Teks sekunder, placeholder** | 6,60 |
| `neutral-700` | `#4f404b` | Teks isi sekunder | 9,69 |
| `neutral-800` | `#322931` | Judul pada panel | 14,03 |
| `neutral-900` | `#1f191e` | **Teks utama** | 17,27 |

> **Aturan kontras:** `neutral-500` (4,27:1) **tidak boleh** dipakai untuk teks kecil karena di bawah 4,5:1. Pakai `neutral-600` untuk teks sekunder dan placeholder. `neutral-500` hanya untuk batas input (komponen UI cukup 3:1) dan ikon.

### 2.3 Warna semantik

| Makna | Warna solid | Latar tint | Teks pada tint | Kontras teks/tint |
|---|---|---|---|---|
| Sukses | `#1f7a4d` | `#e8f5ee` | `#14573a` | 7,63 |
| Peringatan | `#9a6700` | `#fdf3dc` | `#7a5200` | 6,27 |
| Bahaya | `#c4281c` | `#fdeceb` | `#9b1c13` | 7,15 |
| Informasi | `#1d5fd1` | `#e8f0fd` | `#174a9f` | 7,28 |
| Netral | `#6b5766` | `#f1eef0` | `#4f404b` | 8,41 |

Magenta dan merah berdekatan secara persepsi. Pemisahnya: **error selalu memakai merah `#c4281c` disertai ikon dan teks**, dan tombol destruktif selalu merah, tidak pernah magenta.

### 2.4 Pemetaan status

| Konteks | Status | Warna | Ikon |
|---|---|---|---|
| Santri | Aktif | Sukses | lingkaran centang |
| Santri | Indent | Informasi | jam pasir |
| Santri | Cuti | Peringatan | jeda |
| Santri | Keluar | Netral | panah keluar |
| Tagihan | Terbayar | Sukses | centang |
| Tagihan | Belum bayar | Peringatan | lingkaran kosong |
| Tagihan | Menunggu verifikasi | Informasi | jam |
| Tagihan | Tunggakan | Bahaya | segitiga seru |
| Pengajuan | Menunggu | Merek (`brand-100` / `brand-800`) | jam |
| Pengajuan | Disetujui / Ditolak | Sukses / Bahaya | centang / silang |

### 2.5 Warna grafik

- **Keuangan:** terbayar = sukses, belum bayar = peringatan, tunggakan = bahaya (mengikuti pemetaan status).
- **Hafalan per kelas:** satu seri, batang `brand-600`; kelas pembanding memakai `neutral-300`.
- **Kategorikal (maks. 4 seri):** `#ad1d8e`, `#0f766e` (5,47:1), `#b45309` (5,02:1), `#1d5fd1` (5,82:1). Beri label langsung pada grafik, jangan mengandalkan legenda warna saja.

### 2.6 Mode gelap (opsional, Fase 2)

Latar `#17101a`, permukaan `#211a24`, teks `#f4f1f3` (16,64:1), teks sekunder `#af9dab` (7,32:1), aksen `brand-400` `#e05cc4` (5,77:1 pada latar). Sidebar tetap plum, sedikit lebih gelap dari area kerja.

## 3. Tipografi

| Peran | Font | Catatan |
|---|---|---|
| Antarmuka dan judul | **Plus Jakarta Sans** | Geometris, ramah, dirancang di Indonesia; tetap terbaca di ukuran kecil. Fallback: `system-ui, sans-serif` |
| Nama surah (Arab) | **Noto Naskh Arabic** | Hanya untuk teks Arab pada pemilih surah dan kartu hafalan. Atur `lang="ar"` dan `dir="rtl"` pada elemennya |

Angka pada tabel keuangan memakai `font-variant-numeric: tabular-nums` agar kolom nominal sejajar. Uji dengan font yang dipilih; bila tidak mendukung angka tabular, pakai fallback.

**Skala (rem, basis 16px)**

| Token | Ukuran / tinggi baris | Berat | Pemakaian |
|---|---|---|---|
| `text-xs` | 12 / 16 | 500 | Badge, keterangan tabel |
| `text-sm` | 14 / 20 | 400–500 | **Teks tabel, label formulir, isi umum** |
| `text-base` | 16 / 24 | 400 | Isi di HP, halaman publik wali |
| `text-lg` | 18 / 28 | 600 | Judul panel |
| `text-xl` | 20 / 28 | 600 | Judul halaman |
| `text-2xl` | 24 / 32 | 600 | Angka utama dashboard |
| `text-3xl` | 30 / 36 | 600 | Hanya halaman masuk |

Aturan: kalimat biasa (*sentence case*), tidak memakai huruf kapital semua untuk label. Panjang baris teks bacaan maksimal 72 karakter. Judul 600, bukan 700+, agar tidak terkesan berat.

## 4. Jarak, sudut, dan elevasi

- **Basis jarak 4 px.** Skala: 4, 8, 12, 16, 24, 32, 48. Jarak antarbagian halaman 24–32; dalam panel 16.
- **Sudut berjenjang menurut hierarki, bukan satu nilai untuk semua:**
  - Input, tombol, badge persegi: **6 px**
  - Panel, dialog, dropdown: **10 px**
  - Pil (badge status, chip filter, item sidebar aktif): **penuh**
  - Tabel: tanpa sudut bulat di baris; hanya pembungkus panel yang bersudut
- **Elevasi minim.** Permukaan dibedakan dengan garis (`neutral-200/300`). Bayangan hanya untuk elemen melayang: dropdown, dialog, toast (`0 8px 24px rgba(45, 11, 38, 0.14)`, bayangan berwarna plum, bukan abu-abu).
- **Garis fokus:** cincin 2 px `brand-600` dengan jarak 2 px dari elemen, terlihat jelas di semua latar.

## 5. Tata letak

### 5.1 Kerangka aplikasi

```
┌──────────────┬─────────────────────────────────────────────────────┐
│ ▌ RTA        │  Dashboard                      Cabang: Supriyadi ▾ │  ← topbar 56px
│              ├─────────────────────────────────────────────────────┤
│ ● Dashboard  │                                                     │
│   SPP        │   (area kerja, lebar maksimal 1280px)               │
│   LPS        │                                                     │
│   Kelas      │                                                     │
│   Pengguna ▾ │                                                     │
│    Santri    │                                                     │
│    Ustadzah  │                                                     │
│    Wali      │                                                     │
│   Role       │                                                     │
│   Akun       │                                                     │
│              │                                                     │
│ Nama pengguna│                                                     │
│ Keluar       │                                                     │
└──────────────┴─────────────────────────────────────────────────────┘
 sidebar 248px, plum (#2d0b26); bisa diciutkan ke 72px (hanya ikon)
```

- Menu yang tidak boleh diakses role **tidak ditampilkan**.
- **Chip cabang** di topbar menunjukkan scope data yang sedang dilihat. Untuk ustadzah, chip ini terkunci (tidak bisa diganti); untuk PJ dan Manajer berupa filter.
- **Di HP (<768 px):** sidebar menjadi *drawer* dari kiri; topbar memuat tombol menu dan nama halaman; tombol aksi utama halaman berada di **bilah bawah** layar.

### 5.2 Breakpoint

| Nama | Lebar | Perilaku |
|---|---|---|
| `sm` | ≥ 640 | Formulir dua kolom |
| `md` | ≥ 768 | Sidebar tetap terlihat (ciut) |
| `lg` | ≥ 1024 | Sidebar penuh |
| `xl` | ≥ 1280 | Area kerja berhenti melebar |

### 5.3 Dashboard

Dashboard bukan deretan kartu berisi angka besar. Susunannya:

```
Dashboard                                        Cabang: Semua ▾   Bulan: Okt 2026 ▾

┌ Perlu tindakan (PJ) ────────────────────────────────────────────────────────┐
│ ▌ 3 pengajuan keluar/mutasi menunggu          [Tinjau]                       │
│ ▌ 7 bukti pembayaran menunggu verifikasi      [Periksa]                      │
└──────────────────────────────────────────────────────────────────────────────┘

Santri                                                  Ustadzah
 178        4        3          2                        12
 aktif      cuti     indent     keluar bulan ini         ustadzah aktif
 ───────────────────────────────────────────────────────────────────────────

Keuangan Oktober
 ██████████████████████░░░░░░░░░▒▒▒▒    Terbayar Rp…   Belum bayar Rp…   Tunggakan Rp…
 Total tagihan Rp…

Hafalan: rata-rata capaian per kelas
 Genuk Juz 30        ████████████░░░░░░  62%
 Supriyadi Juz 30    ██████████░░░░░░░░  51%
 Supriyadi Juz 29    ███████░░░░░░░░░░░  38%
 …
```

- Ringkasan santri berupa **satu baris angka yang dipisah garis tipis**, bukan empat kartu terpisah.
- Keuangan memakai **satu batang bertumpuk** dengan label langsung; angka rupiah rapi dengan `tabular-nums`.
- Hafalan memakai batang horizontal per kelas, bisa diurut.
- Satu-satunya blok berlatar `brand-50` dengan penanda kiri magenta adalah **Perlu tindakan**, karena itu yang butuh keputusan manusia.

### 5.4 Halaman daftar (pola untuk SPP, LPS, Kelas, Santri, Ustadzah, Wali)

```
Manajemen santri                      [Impor data] [Ekspor PDF] [+ Tambah santri]
Cari nama atau nomor induk…    [Cabang ▾] [Kelas ▾] [Status ▾]     178 santri

☐  Nama            No. induk   Kelas              Status        Wali           ⋮
☐  Aisyah Putri    S-0412      Supriyadi Juz 29   ● Aktif       Bpk. Rahmat    ⋮
☐  …
                                              ‹ 1 2 3 … ›   Tampilkan 25 ▾
```

- Aksi utama satu saja ber-warna magenta (**Tambah …**). Impor dan Ekspor tombol sekunder.
- Kolom sensitif dimasking sesuai role; sel yang disembunyikan menampilkan "Disembunyikan" dalam teks sekunder, bukan kosong.
- Pilih baris (kotak centang) memunculkan **bilah aksi massal**, misalnya "Kirim via WhatsApp (5)" pada tabel tagihan.
- Di HP: kolom sekunder disembunyikan, kolom pertama dibuat *sticky*, dan detail baris dibuka dengan ketukan.

### 5.5 Formulir

- Santri baru memakai **stepper empat langkah** (Keluarga → Identitas → Kelas → Status) karena isinya memang urutan. Stepper di HP menjadi "Langkah 2 dari 4".
- Label di atas input, bantuan di bawah, kesalahan di bawah dengan ikon dan teks merah. Validasi muncul setelah kolom ditinggalkan, bukan saat mengetik.
- Satu kolom di HP; dua kolom mulai `sm`.
- Tombol **Simpan** di kanan bawah (bilah tetap di HP); **Batal** sebagai tombol teks.

### 5.6 Halaman publik bukti pembayaran (wali, HP)

```
┌────────────────────────────────┐
│ Rumah Tahfidz Al-Fatihah       │
├────────────────────────────────┤
│ Tagihan keluarga Bapak/Ibu     │
│                                │
│ Aisyah     SPP Oktober  Rp150.000
│ Fatimah    SPP Oktober  Rp 75.000
│ ────────────────────────────── │
│ Total                  Rp225.000
│                                │
│ Transfer ke                    │
│ Bank {nama bank}               │
│ {nomor rekening}   [Salin]     │
│ a.n. {nama rekening}           │
│                                │
│ Sudah transfer?                │
│ ┌────────────────────────────┐ │
│ │  Pilih foto bukti transfer │ │
│ └────────────────────────────┘ │
│ [ Kirim bukti ]                │
└────────────────────────────────┘
```

- Teks `text-base`, tombol tinggi 48 px, satu kolom, tanpa sidebar atau navigasi.
- Hanya nama panggilan, periode, dan nominal. Tidak ada alamat, nomor WA, atau kategori subsidi.
- Setelah kirim: tampilan konfirmasi "Bukti sudah kami terima. Kami akan memeriksanya." dan ringkasan yang dikirim.
- Link kedaluwarsa atau tidak valid: halaman jelas yang menyuruh wali menghubungi ustadzah.

### 5.7 Halaman masuk

Panel kiri plum dengan nama lembaga; panel kanan putih dengan formulir (email, password, tombol **Masuk**). Di HP hanya formulir. Tanpa tulisan promosi.

## 6. Komponen

### 6.1 Tombol

| Varian | Tampilan | Pemakaian |
|---|---|---|
| Utama | Latar `brand-600`, teks putih; hover `brand-700` | **Satu per layar**: Tambah, Simpan, Masuk |
| Sekunder | Latar putih, batas `neutral-500`, teks `neutral-800` | Impor, Ekspor, Batal bertombol |
| Teks | Tanpa latar, teks `brand-700` | Aksi ringan di baris |
| Bahaya | Latar `#c4281c`, teks putih (5,73:1) | Batalkan pembayaran, nonaktifkan akun |

Tinggi 36 px (desktop), **44–48 px di HP**. Keadaan: hover, fokus (cincin), ditekan, nonaktif (opacity 0,5 + `aria-disabled`), memuat (spinner di dalam tombol, lebar tetap).

### 6.2 Input

Tinggi 40 px, batas `neutral-500`, latar putih, sudut 6 px, fokus: batas `brand-600` + cincin. Placeholder `neutral-600`. Kesalahan: batas `#c4281c`, ikon, dan pesan di bawah dihubungkan lewat `aria-describedby`. Kolom no. WA memakai awalan "+62" dan masker angka.

### 6.3 Tabel

- Header `neutral-100`, teks `text-sm` berat 600, *sticky* saat digulir.
- Baris tanpa zebra; pemisah `neutral-200`; hover `brand-50`; baris terpilih `brand-100`.
- Kolom angka rata kanan dengan `tabular-nums`.
- Kepadatan: nyaman (baris 48 px) dan padat (40 px) sebagai pilihan.
- Keadaan: memuat (kerangka baris), kosong ("Belum ada santri di cabang ini" + tombol **Tambah santri**), error (penjelasan + **Coba lagi**).

### 6.4 Badge status

Pil dengan titik atau ikon 12 px + teks, memakai pasangan tint/teks di 2.3. Tinggi 24 px, `text-xs`. Contoh: `● Aktif`, `⏸ Cuti`, `▲ Tunggakan`.

### 6.5 Panel dan dialog

Panel putih, batas `neutral-200`, sudut 10 px, tanpa bayangan. Dialog berlatar putih dengan lapisan gelap `rgba(45,11,38,.5)`, judul berupa kalimat tindakan, dan tombol utama di kanan. Dialog destruktif menyebut akibatnya ("Pembayaran ini akan dibatalkan dan tagihan kembali berstatus Belum bayar") serta meminta **alasan** bila aturan mewajibkan.

### 6.6 Unggah file (bukti pembayaran, impor)

Area unggah bergaris putus-putus `neutral-500`, menerima seret-lepas dan pilih file. Tampilkan: nama file, pratinjau (gambar), **kemajuan kompresi**, ukuran akhir, dan tombol **Ganti**. Penolakan menyebut sebabnya ("Format harus JPG, PNG, WebP, atau PDF" / "Ukuran terlalu besar, maksimal …").

### 6.7 Alur impor

`Unduh template` → `Pilih file` → **ringkasan validasi** ("142 baris benar, 3 baris bermasalah") dengan daftar baris dan alasannya → `Impor` (nonaktif sampai tidak ada error). Karena impor bersifat semua-atau-tidak, tampilkan ini dengan jelas.

### 6.8 Dialog ekspor

Pilih cakupan (sesuai scope), periode, dan filter. Catatan tetap: "Data sensitif disembunyikan sesuai hak akses Anda. Ekspor ini dicatat." Tombol **Ekspor PDF**.

### 6.9 Pengirim WhatsApp

Tombol **Kirim via WhatsApp** pada baris atau bilah aksi massal. Untuk banyak keluarga, tampilkan panel antrean: "Keluarga 3 dari 12 — Bpk. Rahmat" dengan **Buka WhatsApp** dan **Lewati**; keluarga yang sudah dikirim ditandai centang. Sistem mencatat siapa mengirim dan kapan.

### 6.10 Editor role

Matriks: baris menu, kolom aksi (Lihat, Input, Edit, Ekspor, Impor), sel berupa kotak centang. Perubahan permission kritis meminta konfirmasi. Role inti ditandai terkunci dengan ikon gembok dan keterangan.

### 6.11 Notifikasi

- **Toast:** muncul 4 detik di kanan atas (bawah di HP), menyebut hasil dengan kata kerja yang sama dengan tombolnya ("Simpan" → "Tersimpan"). Tidak dipakai untuk error yang butuh tindakan.
- **Alert dalam halaman:** untuk kesalahan validasi dan kondisi penting; tidak menghilang sendiri.

### 6.12 Ikon

Satu set ikon garis (Lucide), tebal garis 1,75, ukuran 16/20 px. Ikon tanpa teks wajib punya label aksesibel.

## 7. Bahasa dan nada

**Umum (antarmuka staf):** efisien, kalimat biasa, kata kerja aktif. Nama aksi konsisten di seluruh alur.

| Konteks | Teks |
|---|---|
| Tombol | Tambah santri · Simpan · Impor data · Ekspor PDF · Kirim via WhatsApp · Setujui · Tolak · Batalkan pembayaran |
| Toast | Tersimpan · Pengajuan terkirim ke PJ · Pembayaran dibatalkan |
| Kosong | "Belum ada santri di cabang ini." + **Tambah santri** |
| Error isian | "Nomor WA harus diawali 08 atau +62." |
| Error umum | "Data belum tersimpan. Periksa koneksi, lalu coba lagi." |
| Login gagal | "Email atau password salah." (tanpa menyebut mana) |
| Login 3x gagal | "Terlalu banyak percobaan. Coba lagi dalam 5 menit." |
| Login 5x gagal | "Akun dikunci sementara selama 5 jam. Hubungi PJ RTA untuk membukanya." |
| Di luar scope | "Anda tidak punya akses ke data ini." (tanpa membocorkan keberadaan data) |

Error tidak meminta maaf dan tidak samar: sebutkan apa yang salah dan cara memperbaikinya.

**Eksternal (wali santri):** hangat, santun, sisipan keislaman secukupnya, singkat, tidak manipulatif, tanpa menyebut kategori subsidi. Pesan WhatsApp maksimal 4–5 baris, emoji secukupnya, dan selalu ditutup dengan tautan (CTA):

```
Assalamu'alaikum Bapak/Ibu 🌿
Tagihan SPP {bulan} untuk {nama_panggilan} sudah tersedia: Rp{total}.
Rincian dan unggah bukti transfer: {link}
Jazakumullahu khairan 🤍
```

Contoh balasan saat bukti ditolak (manual): "Mohon maaf, bukti transfer belum dapat kami cocokkan. Boleh dikirim ulang melalui tautan sebelumnya? Jazakumullahu khairan."

## 8. Aksesibilitas

- **Kontras:** teks ≥ 4,5:1; teks besar dan komponen UI ≥ 3:1. Pasangan yang sudah diukur ada di bagian 2.
- **Fokus keyboard** selalu terlihat (cincin 2 px `brand-600`); urutan tab mengikuti urutan visual; dialog menjebak fokus dan mengembalikannya saat ditutup.
- **Target sentuh** minimal 44×44 px di HP.
- **Status bukan hanya warna:** ikon dan teks menyertai setiap badge dan grafik.
- **Formulir:** setiap input punya label terlihat; pesan error dihubungkan dengan `aria-describedby`; ringkasan error di atas formulir panjang.
- **Tabel:** `<th scope>` yang benar; tabel yang bisa diurut mengumumkan arah urutan.
- **Gerak:** hormati `prefers-reduced-motion`. Atribut `lang="id"` pada dokumen, `lang="ar"` pada teks Arab.

## 9. Gerak

Hanya gerak yang menjawab tindakan pengguna: dropdown dan dialog muncul 150–200 ms, toast masuk/keluar, kerangka pemuatan pada tabel dan kartu, baris baru yang tersimpan disorot singkat (`brand-100`). **Tidak ada** animasi masuk otomatis pada bagian halaman dan tidak ada animasi dekoratif.

## 10. Token (CSS)

```css
:root {
  /* merek */
  --brand-50:#fdf2fa; --brand-100:#fae1f4; --brand-200:#f4c3e9; --brand-300:#ea99d9;
  --brand-400:#e05cc4; --brand-500:#d926b2; --brand-600:#ad1d8e; --brand-700:#8e1574;
  --brand-800:#6e125a; --brand-900:#4d0f40; --brand-950:#2d0b26;

  /* netral */
  --n-0:#ffffff; --n-50:#f9f8f9; --n-100:#f4f1f3; --n-200:#e8e3e7; --n-300:#d6cdd4;
  --n-400:#af9dab; --n-500:#8c7387; --n-600:#6b5766; --n-700:#4f404b; --n-800:#322931; --n-900:#1f191e;

  /* semantik */
  --success:#1f7a4d; --success-bg:#e8f5ee; --success-fg:#14573a;
  --warning:#9a6700; --warning-bg:#fdf3dc; --warning-fg:#7a5200;
  --danger:#c4281c;  --danger-bg:#fdeceb;  --danger-fg:#9b1c13;
  --info:#1d5fd1;    --info-bg:#e8f0fd;    --info-fg:#174a9f;

  /* peran */
  --bg:var(--n-50); --surface:var(--n-0); --border:var(--n-200); --border-strong:var(--n-500);
  --text:var(--n-900); --text-muted:var(--n-600);
  --primary:var(--brand-600); --primary-hover:var(--brand-700);
  --sidebar-bg:var(--brand-950); --sidebar-text:var(--brand-100); --sidebar-muted:var(--brand-300);
  --focus-ring:0 0 0 2px var(--n-0), 0 0 0 4px var(--brand-600);

  /* bentuk */
  --radius-control:6px; --radius-panel:10px; --radius-pill:999px;
  --shadow-float:0 8px 24px rgba(45,11,38,.14);

  /* tipografi */
  --font-sans:'Plus Jakarta Sans', system-ui, sans-serif;
  --font-arabic:'Noto Naskh Arabic', serif;
}
@media (prefers-reduced-motion: reduce){ *{ transition:none !important; animation:none !important; } }
```

Pemetaan ke Tailwind: daftarkan token di `theme.extend.colors` memakai `var(--…)` agar mode gelap cukup mengganti nilai variabel.

## 11. Daftar periksa sebelum rilis

- [ ] Hanya satu tombol utama per layar.
- [ ] Magenta tidak dipakai untuk error; error selalu merah + ikon + teks.
- [ ] Teks sekunder memakai `neutral-600`, bukan `neutral-500`.
- [ ] Semua status punya ikon atau teks, bukan hanya warna.
- [ ] Menu yang tidak berhak tidak tampil; field sensitif dimasking di layar dan di ekspor.
- [ ] Alur wali dan alur ustadzah diuji di HP nyata (layar kecil, koneksi lambat).
- [ ] Tabel kosong, memuat, dan error sudah dirancang.
- [ ] Fokus keyboard terlihat di semua komponen; gerak menghormati `prefers-reduced-motion`.
- [ ] Pesan WhatsApp maksimal 5 baris, ditutup tautan, tanpa kategori subsidi.

---

## Tema G (dipakai di aplikasi sejak Fase 2)

Pilihan akhir dari kanvas desain: **G · Gabungan berry**. Token ada di `apps/web/tailwind.config.js`, kelas komponen di `apps/web/src/index.css`, komponen di `apps/web/src/components/ui.tsx`.

| Token | Nilai |
|---|---|
| Warna merek | `#ad1d8e` (brand-600), hover `#8e1574` |
| Latar halaman | `#fcf8fb`; rail `#f8e8f3` |
| Pastel pendamping | rose `#fae1f4`/`#8e1574` · butter `#fcebc0`/`#7a5200` · lilac `#e9defa`/`#4b33b5` · mint `#d9f1e6`/`#14573a` |
| Status | Lunas/Aktif mint · Menunggu/Indent lilac · Belum/Cuti butter · Tunggakan/Ditolak merah `#fdeceb`/`#9b1c13` · Keluar/Dibatalkan abu |
| Font | Nunito 800–900 untuk judul & angka · Plus Jakarta Sans untuk teks |
| Kartu | putih, sudut 20 px, bayangan `0 6px 18px rgba(125,40,100,.08)` |
| Tombol | pil (radius penuh); utama berry dengan bayangan berry; tinggi 44 px (HP) / 40 px (desktop) |

**Ukuran konsisten (HP):** tepi layar 20 px · antarbagian 24 px · antarkartu 12 px · padding kartu 16 px · avatar & kotak ikon 40 px · tombol utama 48 px · chip 36 px · baris daftar ≥ 72 px · judul 22 / bagian 16 / teks 14 / keterangan 12.

**Aturan responsif**

| Lebar | Navigasi & tata letak |
|---|---|
| ≥ 1024 px | Rail berlabel 96 px + konten (+ panel kanan, mis. input hafalan) |
| 768–1023 px | Rail ikon saja 72 px; panel kanan pindah ke bawah |
| < 768 px | Tab bar bawah (Beranda, Santri, Kelas, Bayar, Lainnya) + sheet *Lainnya*; tabel menjadi kartu; panel geser menjadi sheet dari bawah; tombol utama menempel di bawah |

Scrollbar disembunyikan di seluruh aplikasi; area yang bisa digeser tetap bisa digeser. Teks putih hanya di atas berry atau hijau tua (`#1f7a4d`), tidak di atas pastel.
