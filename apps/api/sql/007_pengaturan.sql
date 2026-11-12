-- Menu Pengaturan: aturan keuangan & template WA yang diatur PJ RTA (bukan lagi env/kode).
-- Kunci yang belum ada memakai nilai bawaan di SettingsService (SETTING_DEFAULTS). Tarif per cabang tetap di tabel branches.
CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by integer REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
