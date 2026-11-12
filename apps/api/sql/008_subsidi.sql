-- Master subsidi SPP (prd.md 8.2): kategori × cabang, diatur PJ di menu Pengaturan.
-- TARIF = tarif pengganti (Rp per cabang). DISKON = persen dari tarif standar cabang. is_sibling = diskon saudara (dicabut otomatis).
-- Tidak ada hapus: kategori dinonaktifkan, ketersediaan per cabang lewat kolom available.
CREATE TABLE subsidies (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('TARIF', 'DISKON')),
  percent integer CHECK (percent BETWEEN 1 AND 100),
  is_sibling boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'TARIF' OR percent IS NOT NULL)
);
CREATE TABLE subsidy_rates (
  subsidy_id integer NOT NULL REFERENCES subsidies(id),
  branch_id integer NOT NULL REFERENCES branches(id),
  available boolean NOT NULL DEFAULT true,
  amount integer CHECK (amount >= 0),          -- hanya untuk TARIF
  note text,                                   -- mis. "Hanya santri pindahan"
  PRIMARY KEY (subsidy_id, branch_id)
);
-- subsidy_label tetap disimpan (nama kategori, snapshot untuk tagihan & label lama teks bebas)
ALTER TABLE students ADD COLUMN subsidy_id integer REFERENCES subsidies(id);
ALTER TABLE students ADD COLUMN subsidy_since date;
CREATE INDEX students_subsidy_idx ON students(subsidy_id) WHERE subsidy_id IS NOT NULL;
