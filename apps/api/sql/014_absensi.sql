-- Menu Absensi: kehadiran harian santri per kelas (H = hadir, I = izin, S = sakit, A = alpa).
-- Satu baris per santri per tanggal (diubah lewat upsert, tidak dihapus; perubahan dicatat di audit_logs).
-- Cabang & kelas disimpan per baris agar rekap tetap benar setelah mutasi.
-- Hari belajar & ambang "perlu perhatian" ada di tabel settings (attendanceDays, attendanceAlpaStreak, attendanceMinPercent).
-- Hari libur dibaca dari agendas kategori LIBUR.
CREATE TABLE attendance (
  id serial PRIMARY KEY,
  student_id integer NOT NULL REFERENCES students(id),
  branch_id integer NOT NULL REFERENCES branches(id),
  class_id integer NOT NULL REFERENCES classes(id),
  date date NOT NULL,
  status text NOT NULL CHECK (status IN ('H', 'I', 'S', 'A')),
  note text,                                   -- keterangan izin/sakit (dimasking untuk role non-sensitif)
  recorded_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer REFERENCES users(id),
  updated_at timestamptz
);
CREATE UNIQUE INDEX attendance_student_date_idx ON attendance(student_id, date);
CREATE INDEX attendance_class_date_idx ON attendance(class_id, date);
CREATE INDEX attendance_branch_date_idx ON attendance(branch_id, date);
