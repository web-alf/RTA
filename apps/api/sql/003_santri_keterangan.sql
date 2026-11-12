-- Kolom santri disamakan dengan spreadsheet data santri (ID Santri … Pekerjaan Ibu).
-- Kolom lain sudah ada: students (nis, full_name, gender, birth_place, birth_date, branch_id, class_id, join_date, status, subsidy_label)
-- dan families (father_name, mother_name, wa_phone, address, father_job, mother_job).
ALTER TABLE students ADD COLUMN registration_note text; -- "Keterangan Pendaftaran", mis. "Daftar via WA", "Pindahan dari TPQ X"
