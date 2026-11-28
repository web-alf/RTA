# Aset PDF LPS

Dipakai `src/modules/lps/lps-pdf.ts`. Wajib ikut di-deploy (Docker sudah otomatis; cPanel: unggah folder `assets/`).

| File | Isi |
|---|---|
| `template-putra.jpg` | Latar halaman 1024 × 1536 px, **tanpa teks isian** (ilustrasi, kartu, judul, label tetap). |
| `template-putri.jpg` | *(Opsional, belum ada)* versi maskot santri putri. Dipakai otomatis untuk santri `gender = 'P'`; bila tidak ada, memakai template putra. |
| `nunito-400/600/800.ttf` | Font Nunito, SIL Open Font License 1.1 (https://openfontlicense.org), boleh disertakan. |

## Mengganti template

- Template sekarang dibuat dari gambar contoh (resolusi rendah, agak buram bila dicetak). Ganti dengan desain resolusi tinggi bila sudah ada.
- Ukuran berbeda boleh asal rasio 2:3; posisi teks di `lps-pdf.ts` dalam piksel template 1024 × 1536 (ubah `TW`/`TH` dan konstanta posisi bila tata letak berubah).
- Template harus kosong dari nama/data santri sungguhan.
