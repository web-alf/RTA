-- Link LPS untuk wali (kirim lewat wa.me): token acak disimpan sebagai hash SHA-256, berlaku linkDays hari (Pengaturan).
-- Satu link aktif per LPS: membuat link baru mencabut link lama. Baris tidak dihapus (riwayat kirim).
CREATE TABLE lps_links (
  id serial PRIMARY KEY,
  lps_id integer NOT NULL REFERENCES lps_reports(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lps_links_lps_idx ON lps_links(lps_id);
