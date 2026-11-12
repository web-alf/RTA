-- Role Admin Sistem digabung ke PJ RTA; tambah role Wali Santri (akun wali terhubung ke satu keluarga).

-- akun wali → keluarga (NULL untuk akun staf)
ALTER TABLE users ADD COLUMN family_id integer REFERENCES families(id);
CREATE INDEX user_family_idx ON users(family_id);

-- gabung ADMIN → PJ: akun admin dipindah ke PJ, role ADMIN dilepas (permission ikut terhapus lewat ON DELETE CASCADE).
-- Pada database baru tabel roles masih kosong di tahap ini; seed tidak lagi membuat ADMIN.
UPDATE users SET role_id = (SELECT id FROM roles WHERE code = 'PJ')
WHERE role_id = (SELECT id FROM roles WHERE code = 'ADMIN') AND EXISTS (SELECT 1 FROM roles WHERE code = 'PJ');
DELETE FROM roles WHERE code = 'ADMIN' AND NOT EXISTS (SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'ADMIN');
