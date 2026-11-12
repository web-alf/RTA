-- Fase 2A (hafalan), 2B (SPP & pembayaran), 3 (LPS), profil & sesi.

-- ---------- Profil & sesi ----------
ALTER TABLE users ADD COLUMN prefs jsonb NOT NULL DEFAULT '{"notifHafalan":true,"notifBukti":true,"notifPengajuan":true,"textSize":"normal"}';
ALTER TABLE users ADD COLUMN password_changed_at timestamptz;
ALTER TABLE refresh_tokens ADD COLUMN user_agent text;
ALTER TABLE refresh_tokens ADD COLUMN ip text;
ALTER TABLE refresh_tokens ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE refresh_tokens ADD COLUMN session_id text; -- sama untuk satu rantai rotasi (= satu perangkat)

-- ---------- Santri: tarif khusus / subsidi (dipasang PJ) ----------
ALTER TABLE students ADD COLUMN subsidy_label text; -- sensitif: mis. "Yatim", "Saudara kandung"

-- ---------- Pengajuan bisa ditarik ----------
-- state: MENUNGGU | DISETUJUI | DITOLAK | DITARIK (tidak perlu ALTER, kolom text)
-- cabang & kelas asal disimpan agar riwayat mutasi tetap benar setelah santri pindah
ALTER TABLE requests ADD COLUMN from_branch_id integer REFERENCES branches(id);
ALTER TABLE requests ADD COLUMN from_class_id integer REFERENCES classes(id);
UPDATE requests r SET from_branch_id = s.branch_id, from_class_id = s.class_id FROM students s WHERE s.id = r.student_id AND r.from_branch_id IS NULL;

-- ---------- Referensi surah ----------
CREATE TABLE surahs (
  id serial PRIMARY KEY,
  level text NOT NULL,        -- JUZ30 | JUZ29 | JUZ28
  ord integer NOT NULL,       -- urutan hafalan dalam juz (1 = surah pertama)
  name text NOT NULL,
  ayat_count integer NOT NULL,
  UNIQUE (level, ord)
);

-- ---------- Capaian hafalan ----------
CREATE TABLE memorization_records (
  id serial PRIMARY KEY,
  student_id integer NOT NULL REFERENCES students(id),
  branch_id integer NOT NULL REFERENCES branches(id),   -- snapshot saat input
  class_id integer NOT NULL REFERENCES classes(id),     -- snapshot saat input
  level text NOT NULL,
  surah_id integer NOT NULL REFERENCES surahs(id),
  ayat integer NOT NULL,
  total_ayat integer NOT NULL,      -- jumlah ayat kumulatif dalam juz
  percent numeric(5,2) NOT NULL,
  week_start date NOT NULL,         -- Senin pekan input (Asia/Jakarta)
  recorded_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mem_student_week_idx ON memorization_records(student_id, week_start DESC, id DESC);

-- ---------- Tagihan ----------
CREATE TABLE invoices (
  id serial PRIMARY KEY,
  student_id integer NOT NULL REFERENCES students(id),
  family_id integer NOT NULL REFERENCES families(id),
  branch_id integer NOT NULL REFERENCES branches(id),   -- snapshot
  type text NOT NULL,               -- PENDAFTARAN | DAFTAR_ULANG | SPP
  period date NOT NULL,             -- SPP: tgl 1 bulan tagihan; lainnya: tanggal terbit
  label text NOT NULL,              -- mis. "SPP Oktober 2026"
  amount integer NOT NULL,          -- rupiah
  note text,                        -- mis. "diskon saudara"
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invoice_unique_idx ON invoices(student_id, type, period) WHERE voided_at IS NULL;
CREATE INDEX invoice_family_idx ON invoices(family_id);

-- ---------- Pembayaran ----------
CREATE TABLE payments (
  id serial PRIMARY KEY,
  family_id integer NOT NULL REFERENCES families(id),
  amount integer NOT NULL,
  paid_at date NOT NULL,
  method text NOT NULL,             -- TRANSFER | TUNAI
  source text NOT NULL,             -- WEB (wali) | WA (diunggah ustadzah) | TUNAI
  state text NOT NULL,              -- MENUNGGU | TERVERIFIKASI | DIBATALKAN
  proof_path text,
  note text,
  recorded_by integer REFERENCES users(id),             -- NULL bila diunggah wali lewat link
  verified_by integer REFERENCES users(id),
  verified_at timestamptz,
  cancel_reason text,
  canceled_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_family_idx ON payments(family_id);

CREATE TABLE payment_allocations (
  payment_id integer NOT NULL REFERENCES payments(id),
  invoice_id integer NOT NULL REFERENCES invoices(id),
  amount integer NOT NULL,
  PRIMARY KEY (payment_id, invoice_id)
);

-- ---------- Link tagihan untuk wali (token) & log kirim WA ----------
CREATE TABLE payment_links (
  id serial PRIMARY KEY,
  family_id integer NOT NULL REFERENCES families(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wa_dispatch_log (
  id serial PRIMARY KEY,
  family_id integer NOT NULL REFERENCES families(id),
  user_id integer NOT NULL REFERENCES users(id),
  total integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- LPS ----------
CREATE TABLE lps_reports (
  id serial PRIMARY KEY,
  student_id integer NOT NULL REFERENCES students(id),
  branch_id integer NOT NULL REFERENCES branches(id),
  period date NOT NULL,             -- tgl 1 bulan laporan
  status text NOT NULL DEFAULT 'DRAFT',   -- DRAFT | DIPERIKSA | DISETUJUI | TERBIT
  scores jsonb NOT NULL DEFAULT '{}',     -- {"BTQ":"Sangat baik", ...}
  note text,
  hafalan_percent numeric(5,2),     -- ditarik otomatis saat dibuat/diperbarui
  hafalan_position text,
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (student_id, period)
);
