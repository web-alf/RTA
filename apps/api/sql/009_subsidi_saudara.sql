-- Kategori "Saudara kandung" diganti nama menjadi "Saudara" (label santri ikut). Dilewati bila PJ sudah membuat/mengganti nama sendiri.
UPDATE students s SET subsidy_label = 'Saudara'
  FROM subsidies x
 WHERE s.subsidy_id = x.id AND x.name = 'Saudara kandung'
   AND NOT EXISTS (SELECT 1 FROM subsidies y WHERE y.name = 'Saudara');
UPDATE subsidies SET name = 'Saudara'
 WHERE name = 'Saudara kandung'
   AND NOT EXISTS (SELECT 1 FROM subsidies y WHERE y.name = 'Saudara');
