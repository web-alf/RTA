-- Skema Fase 1. Nama tabel/kolom snake_case; API mengembalikan camelCase lewat alias di SELECT.

CREATE TABLE roles (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,            -- ADMIN | PJ | USTADZAH | MANAJER
  name text NOT NULL,
  is_core boolean NOT NULL DEFAULT false
);

CREATE TABLE role_permissions (          -- perm = "<menu>.<aksi>", mis. santri.input
  role_id integer NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  perm text NOT NULL,
  PRIMARY KEY (role_id, perm)
);

CREATE TABLE users (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text,
  password_hash text NOT NULL,
  role_id integer NOT NULL REFERENCES roles(id),
  is_active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE branches (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  spp_standard integer NOT NULL,         -- rupiah, integer
  registration_fee integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE classes (                   -- kelas = cabang x jenjang
  id serial PRIMARY KEY,
  branch_id integer NOT NULL REFERENCES branches(id),
  level text NOT NULL,                   -- JUZ30 | JUZ29 | JUZ28
  name text NOT NULL,
  UNIQUE (branch_id, level)
);

CREATE TABLE user_branches (             -- penugasan ustadzah (bisa >1, pengganti punya end_date)
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id integer NOT NULL REFERENCES branches(id),
  start_date date NOT NULL,
  end_date date
);
CREATE INDEX ub_user_idx ON user_branches(user_id);

CREATE TABLE refresh_tokens (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);

CREATE TABLE status_reasons (
  id serial PRIMARY KEY,
  kind text NOT NULL,                    -- CUTI | KELUAR
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE families (                  -- data wali, sekali per keluarga
  id serial PRIMARY KEY,
  father_name text NOT NULL,
  mother_name text NOT NULL,
  guardian_name text,
  guardian_relation text,
  wa_phone text NOT NULL,                -- sensitif
  backup_phone text,                     -- sensitif
  address text NOT NULL,                 -- sensitif
  father_job text,                       -- sensitif
  mother_job text,                       -- sensitif
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX family_wa_idx ON families(wa_phone);

CREATE TABLE students (
  id serial PRIMARY KEY,
  nis text NOT NULL UNIQUE,
  full_name text NOT NULL,
  nickname text,
  gender text NOT NULL,                  -- L | P
  birth_place text NOT NULL,
  birth_date date NOT NULL,
  school text,
  family_id integer NOT NULL REFERENCES families(id),
  branch_id integer NOT NULL REFERENCES branches(id),
  class_id integer NOT NULL REFERENCES classes(id),
  join_date date NOT NULL,
  status text NOT NULL DEFAULT 'INDENT', -- INDENT | AKTIF | CUTI | KELUAR
  health_notes text,                     -- sensitif
  spp_rate integer NOT NULL,             -- snapshot tarif saat daftar
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX student_branch_idx ON students(branch_id);
CREATE INDEX student_family_idx ON students(family_id);

CREATE TABLE student_placements (        -- riwayat cabang/kelas
  id serial PRIMARY KEY,
  student_id integer NOT NULL REFERENCES students(id),
  branch_id integer NOT NULL REFERENCES branches(id),
  class_id integer NOT NULL REFERENCES classes(id),
  effective_date date NOT NULL,
  note text
);

CREATE TABLE status_history (
  id serial PRIMARY KEY,
  student_id integer NOT NULL REFERENCES students(id),
  from_status text,
  to_status text NOT NULL,
  effective_date date NOT NULL,
  reason text,
  note text,
  actor_id integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE requests (                  -- pengajuan keluar/mutasi, terpisah dari status
  id serial PRIMARY KEY,
  student_id integer NOT NULL REFERENCES students(id),
  type text NOT NULL,                    -- KELUAR | MUTASI
  state text NOT NULL DEFAULT 'MENUNGGU',-- MENUNGGU | DISETUJUI | DITOLAK
  effective_date date NOT NULL,
  reason text NOT NULL,
  target_branch_id integer REFERENCES branches(id),
  target_class_id integer REFERENCES classes(id),
  note text,
  requested_by integer NOT NULL REFERENCES users(id),
  decided_by integer REFERENCES users(id),
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE TABLE audit_logs (
  id serial PRIMARY KEY,
  actor_id integer REFERENCES users(id),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id integer,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_logs(entity, entity_id);

CREATE TABLE export_logs (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  report text NOT NULL,
  filters jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
