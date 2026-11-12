-- Rekening transfer per cabang (Pengaturan → Rekening per cabang). PJ mengubah semua cabang, ustadzah hanya cabangnya.
-- Nilai awal disalin dari rekening tunggal lama di tabel settings (bila pernah diubah PJ); NULL = memakai rekening bawaan yayasan.
ALTER TABLE branches ADD COLUMN bank_name text;
ALTER TABLE branches ADD COLUMN bank_account text;
ALTER TABLE branches ADD COLUMN bank_holder text;
UPDATE branches SET
  bank_name = (SELECT value #>> '{}' FROM settings WHERE key = 'bankName'),
  bank_account = (SELECT value #>> '{}' FROM settings WHERE key = 'bankAccount'),
  bank_holder = (SELECT value #>> '{}' FROM settings WHERE key = 'bankHolder');
