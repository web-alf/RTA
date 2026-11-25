-- Impor data lama: Tanggal Bergabung boleh kosong = santri lama (mengulang, atau tanggal masuknya tidak tercatat).
-- join_date NULL diperlakukan "sudah bergabung sejak dulu": ikut tagihan SPP bulanan bila Aktif dan tampil di absensi,
-- tidak dibuatkan tagihan pendaftaran, dan tidak muncul di menu Pendaftaran (filter join_date >= awal tahun ajaran).
-- Form "Tambah santri" tetap mewajibkan tanggal bergabung (StudentDto).
ALTER TABLE students ALTER COLUMN join_date DROP NOT NULL;
