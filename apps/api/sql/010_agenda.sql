-- Agenda RTA (menu Agenda): kegiatan, libur, ujian, rapat. Dikelola PJ; staf melihat agenda umum + cabangnya.
-- branch_id NULL = berlaku untuk semua cabang. Tidak ada hapus permanen: agenda dibatalkan dengan alasan (cancelled_at).
CREATE TABLE agendas (
  id serial PRIMARY KEY,
  title text NOT NULL,
  category text NOT NULL CHECK (category IN ('KEGIATAN', 'LIBUR', 'UJIAN', 'RAPAT', 'LAINNYA')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  start_time time,
  end_time time,
  location text,
  note text,
  branch_id integer REFERENCES branches(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer REFERENCES users(id),
  updated_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by integer REFERENCES users(id),
  cancel_reason text,
  CHECK (end_date >= start_date),
  CHECK (end_time IS NULL OR start_time IS NULL OR start_date < end_date OR end_time >= start_time)
);
CREATE INDEX agendas_range_idx ON agendas(start_date, end_date) WHERE cancelled_at IS NULL;
CREATE INDEX agendas_branch_idx ON agendas(branch_id);
