-- Impor data lama: hanya ID Santri, Nama, Jenis Kelamin, Cabang, Jenjang, Tanggal Bergabung, Status, dan Keterangan Pendaftaran
-- yang wajib. Tempat/tanggal lahir dan data keluarga (nama ayah/ibu, no. WA, alamat) boleh kosong lalu dilengkapi kemudian.
-- Form "Tambah santri" tetap mewajibkan kolom-kolom ini (divalidasi di StudentDto / FamilyDto).
-- Keluarga tanpa no. WA tidak bisa dikirimi link tagihan sampai nomornya diisi di menu Wali santri.
ALTER TABLE students ALTER COLUMN birth_place DROP NOT NULL, ALTER COLUMN birth_date DROP NOT NULL;
ALTER TABLE families ALTER COLUMN father_name DROP NOT NULL, ALTER COLUMN mother_name DROP NOT NULL,
  ALTER COLUMN wa_phone DROP NOT NULL, ALTER COLUMN address DROP NOT NULL;
