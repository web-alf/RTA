-- Menu Kas: penjualan barang ke santri (stok per cabang), pengeluaran (persetujuan PJ), kategori yang bisa diatur PJ.
-- Pemasukan SPP/pendaftaran/daftar ulang TIDAK dicatat ulang: kas membacanya dari pembayaran terverifikasi.
-- Tidak ada hapus permanen: kategori/barang dinonaktifkan; penjualan & pengeluaran dibatalkan dengan alasan.

CREATE TABLE item_categories (                 -- kategori barang (Buku & mushaf, Seragam, ...)
  id serial PRIMARY KEY,
  name text NOT NULL,
  icon text NOT NULL DEFAULT 'BOX',             -- BOOK | SHIRT | STAR | BOX (ikon di katalog)
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX item_category_name_idx ON item_categories(lower(name));

CREATE TABLE items (                           -- jenis barang dalam kategori; harga sama untuk semua cabang
  id serial PRIMARY KEY,
  category_id integer NOT NULL REFERENCES item_categories(id),
  name text NOT NULL,
  price integer NOT NULL CHECK (price >= 0),
  low_stock integer NOT NULL DEFAULT 3 CHECK (low_stock >= 0), -- batas "hampir habis"
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX item_name_idx ON items(lower(name));

CREATE TABLE expense_categories (              -- kategori pengeluaran (ATK, Konsumsi, ...)
  id serial PRIMARY KEY,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX expense_category_name_idx ON expense_categories(lower(name));

CREATE TABLE sales (                           -- penjualan barang ke santri
  id serial PRIMARY KEY,
  student_id integer NOT NULL REFERENCES students(id),
  family_id integer NOT NULL REFERENCES families(id),
  branch_id integer NOT NULL REFERENCES branches(id),   -- cabang santri saat jual (stok berkurang di sini)
  sold_at date NOT NULL,
  method text NOT NULL CHECK (method IN ('TUNAI', 'TRANSFER', 'TAGIHAN')), -- TAGIHAN = jadi tagihan BARANG di menu Bayar
  total integer NOT NULL CHECK (total >= 0),
  proof_path text,
  invoice_id integer REFERENCES invoices(id),
  canceled_at timestamptz,
  cancel_reason text,
  canceled_by integer REFERENCES users(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_student_idx ON sales(student_id);
CREATE INDEX sale_date_idx ON sales(sold_at);

CREATE TABLE sale_items (
  sale_id integer NOT NULL REFERENCES sales(id),
  item_id integer NOT NULL REFERENCES items(id),
  name text NOT NULL,                            -- snapshot nama & harga saat jual
  price integer NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  PRIMARY KEY (sale_id, item_id)
);

CREATE TABLE expenses (
  id serial PRIMARY KEY,
  branch_id integer NOT NULL REFERENCES branches(id),
  category_id integer NOT NULL REFERENCES expense_categories(id),
  amount integer NOT NULL CHECK (amount > 0),
  description text NOT NULL,
  spent_at date NOT NULL,
  method text NOT NULL CHECK (method IN ('TUNAI', 'TRANSFER')),
  proof_path text,                               -- foto nota (opsional)
  state text NOT NULL CHECK (state IN ('MENUNGGU', 'DISETUJUI', 'DITOLAK', 'DIBATALKAN')),
  decided_by integer REFERENCES users(id),
  decided_at timestamptz,
  reason text,                                   -- alasan tolak / batal
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expense_date_idx ON expenses(spent_at);

CREATE TABLE expense_items (                   -- restock: stok bertambah saat pengeluaran disetujui
  expense_id integer NOT NULL REFERENCES expenses(id),
  item_id integer NOT NULL REFERENCES items(id),
  qty integer NOT NULL CHECK (qty > 0),
  PRIMARY KEY (expense_id, item_id)
);

-- Stok = SUM(delta) per barang per cabang (tidak disimpan sebagai angka, agar selalu cocok dengan riwayat)
CREATE TABLE stock_moves (
  id serial PRIMARY KEY,
  item_id integer NOT NULL REFERENCES items(id),
  branch_id integer NOT NULL REFERENCES branches(id),
  delta integer NOT NULL CHECK (delta <> 0),
  kind text NOT NULL CHECK (kind IN ('RESTOCK', 'JUAL', 'BATAL_JUAL', 'BATAL_RESTOCK', 'KOREKSI')),
  sale_id integer REFERENCES sales(id),
  expense_id integer REFERENCES expenses(id),
  note text,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_item_branch_idx ON stock_moves(item_id, branch_id);

-- Tagihan barang (type BARANG): satu santri bisa beberapa kali dalam sehari, jadi dikecualikan dari indeks unik.
DROP INDEX invoice_unique_idx;
CREATE UNIQUE INDEX invoice_unique_idx ON invoices(student_id, type, period) WHERE voided_at IS NULL AND type <> 'BARANG';

-- Kategori bawaan (bisa diubah/dinonaktifkan PJ di menu Kas → Kelola)
INSERT INTO item_categories(name, icon) VALUES ('Buku & mushaf', 'BOOK'), ('Seragam', 'SHIRT'), ('Perlengkapan', 'BOX');
INSERT INTO expense_categories(name) VALUES ('ATK'), ('Konsumsi kegiatan'), ('Listrik & air'), ('Buku & perlengkapan'), ('Perawatan tempat'), ('Lainnya');
