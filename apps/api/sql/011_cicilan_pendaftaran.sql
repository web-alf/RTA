-- Cicilan biaya pendaftaran (menu Pendaftaran). Satu cicilan = satu tagihan PENDAFTARAN dengan nominal & jatuh tempo sendiri,
-- sehingga aturan "nominal = tagihan yang dipilih" dan status turunan dari pembayaran tetap berlaku (tanpa bayar sebagian).
-- installment_total NULL = skema belum diatur (dibayar lunas seperti biasa); 1 = lunas langsung; > 1 = cicil.
-- due_date NULL = status lama (tunggakan per bulan); terisi = terlambat per hari, dan "terjadwal" sebelum bulan jatuh temponya.
ALTER TABLE invoices ADD COLUMN due_date date;
ALTER TABLE invoices ADD COLUMN installment_no smallint;
ALTER TABLE invoices ADD COLUMN installment_total smallint;
ALTER TABLE invoices ADD CONSTRAINT invoice_installment_chk
  CHECK (installment_total IS NULL OR (installment_total >= 1 AND installment_no BETWEEN 1 AND installment_total));
