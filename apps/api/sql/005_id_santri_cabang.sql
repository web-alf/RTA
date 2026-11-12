-- ID santri baru: RTA-<kode cabang pendaftaran>-<urut 3 digit per cabang>, mis. RTA-GNK-001.
-- ID tidak berubah saat mutasi. ID format lama disimpan di legacy_nis (tetap bisa dicari).
ALTER TABLE students ADD COLUMN legacy_nis text;

-- ubah ID lama: cabang = penempatan pertama (pendaftaran), urut per cabang menurut tanggal bergabung
WITH first AS (
  SELECT s.id, s.nis, s.join_date,
         COALESCE((SELECT p.branch_id FROM student_placements p WHERE p.student_id = s.id ORDER BY p.effective_date, p.id LIMIT 1), s.branch_id) AS branch_id
  FROM students s WHERE s.nis !~ '^RTA-'
), last AS ( -- lanjutkan dari nomor RTA-… terakhir per kode cabang (bila sudah ada)
  SELECT substring(nis FROM '^RTA-([A-Z]+)-') AS code, MAX(substring(nis FROM '-([0-9]+)$')::int) AS n FROM students WHERE nis ~ '^RTA-[A-Z]+-[0-9]+$' GROUP BY 1
), numbered AS (
  SELECT f.id, f.nis, 'RTA-' || b.code || '-' || lpad((COALESCE(l.n, 0) + row_number() OVER (PARTITION BY f.branch_id ORDER BY f.join_date, f.id))::text, 3, '0') AS new_nis
  FROM first f JOIN branches b ON b.id = f.branch_id LEFT JOIN last l ON l.code = b.code
)
UPDATE students s SET legacy_nis = n.nis, nis = n.new_nis FROM numbered n WHERE s.id = n.id;
