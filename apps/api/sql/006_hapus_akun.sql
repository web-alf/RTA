-- Hapus akun bertahap: PJ menandai akun → masuk daftar hapus 30 hari (bisa dibatalkan) → dihapus permanen oleh penjadwal.
-- "Hapus permanen" = data login & pribadi dibersihkan, baris akun dan NAMA tetap ada agar riwayat (dicatat/diubah oleh) tetap terbaca.
ALTER TABLE users ADD COLUMN delete_after date;                          -- terisi = sedang di daftar hapus
ALTER TABLE users ADD COLUMN delete_reason text;
ALTER TABLE users ADD COLUMN delete_requested_by integer REFERENCES users(id);
ALTER TABLE users ADD COLUMN deleted_at timestamptz;                     -- terisi = sudah dihapus permanen
CREATE INDEX user_delete_after_idx ON users(delete_after) WHERE delete_after IS NOT NULL AND deleted_at IS NULL;
