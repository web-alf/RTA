import type { Response } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

/**
 * Ekspor laporan bersama (SPP, Pendaftaran, Kas): Excel untuk diolah, PDF untuk dicetak/dibagikan.
 * Pemanggil wajib sudah menyaring scope cabang & field sensitif; helper ini hanya menyusun file.
 */
export type Col = { header: string; key: string; width?: number; money?: boolean; date?: boolean; align?: 'left' | 'right' };
export type Sheet = { name: string; columns: Col[]; rows: Record<string, any>[]; totals?: Record<string, any> };
export type ReportMeta = { title: string; subtitle: string; summary?: [string, string][] };

const BRAND = 'FFAD1D8E';
const NOTE = 'Data internal Rumah Tahfidz Al-Fatihah. Jangan dibagikan ke grup terbuka; cocokkan dengan mutasi bank sebelum dipublikasikan.';
const ymd = (v: any) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : '');
const dmy = (v: any) => { const s = ymd(v); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; };
export const rp = (n: number) => { const v = Math.round(Number(n) || 0); return (v < 0 ? '−Rp' : 'Rp') + Math.abs(v).toLocaleString('id-ID'); };
const safe = (s: string) => s.replace(/[^\w.-]+/g, '-');

export async function sendXlsx(res: Response, filename: string, meta: ReportMeta, sheets: Sheet[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dashboard RTA';
  wb.created = new Date();
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name.replace(/[*?:\\/[\]]/g, '-').slice(0, 31)); // Excel melarang * ? : \ / [ ] di nama sheet
    ws.addRow([meta.title]).font = { bold: true, size: 14, color: { argb: BRAND } };
    ws.addRow([meta.subtitle]).font = { color: { argb: 'FF6B5766' } };
    for (const [k, v] of meta.summary && sh === sheets[0] ? meta.summary : []) ws.addRow([k, v]).getCell(1).font = { bold: true };
    ws.addRow([]);
    const head = ws.addRow(sh.columns.map((c) => c.header));
    head.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }; c.alignment = { vertical: 'middle', wrapText: true }; });
    const headRow = head.number;
    for (const r of sh.rows) ws.addRow(sh.columns.map((c) => (c.date ? (r[c.key] ? new Date(ymd(r[c.key]) + 'T00:00:00Z') : null) : r[c.key] ?? '')));
    if (sh.totals) { const t = ws.addRow(sh.columns.map((c) => sh.totals![c.key] ?? '')); t.font = { bold: true }; }
    sh.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width ?? Math.min(40, Math.max(10, c.header.length + 2));
      if (c.money) col.numFmt = '"Rp"#,##0;-"Rp"#,##0';
      if (c.date) col.numFmt = 'dd/mm/yyyy';
    });
    ws.views = [{ state: 'frozen', ySplit: headRow }];
    ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: headRow, column: sh.columns.length } };
    ws.addRow([]);
    ws.addRow([NOTE]).font = { italic: true, size: 9, color: { argb: 'FF6B5766' } };
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safe(filename)}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}

/** PDF: judul, ringkasan, lalu tabel per bagian (kolom diskalakan ke lebar halaman). */
export function sendPdf(res: Response, filename: string, meta: ReportMeta, sheets: Sheet[], opt: { landscape?: boolean; footnote?: string } = {}) {
  const M = 28, PW = opt.landscape ? 842 : 595, PH = opt.landscape ? 595 : 842, W = PW - 2 * M;
  const doc = new PDFDocument({ size: 'A4', layout: opt.landscape ? 'landscape' : 'portrait', margin: M });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safe(filename)}.pdf"`);
  doc.pipe(res);
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#ad1d8e').text(meta.title);
  doc.font('Helvetica').fontSize(8.5).fillColor('#4f404b').text(`${meta.subtitle} · ${NOTE}`);
  if (meta.summary?.length) {
    doc.moveDown(0.5).fontSize(9.5).fillColor('#1f191e');
    doc.text(meta.summary.map(([k, v]) => `${k}: ${v}`).join('     ·     '), { width: W });
  }
  for (const sh of sheets) {
    const scale = W / sh.columns.reduce((a, c) => a + (c.width ?? 12), 0);
    const widths = sh.columns.map((c) => (c.width ?? 12) * scale);
    const cell = (c: Col, r: any) => (c.money ? (r[c.key] === '' || r[c.key] == null ? '' : rp(r[c.key])) : c.date ? dmy(r[c.key]) : String(r[c.key] ?? ''));
    const row = (vals: string[], bold = false, fill?: string) => {
      doc.fontSize(7.5).font(bold ? 'Helvetica-Bold' : 'Helvetica');
      const h = Math.max(...vals.map((v, i) => doc.heightOfString(v, { width: widths[i] - 6 }))) + 6;
      if (doc.y + h > PH - M) { doc.addPage(); if (!bold) row(sh.columns.map((c) => c.header), true, '#f6edf3'); doc.fontSize(7.5).font('Helvetica'); }
      const y = doc.y; let x = M;
      if (fill) doc.rect(M, y, W, h).fill(fill);
      vals.forEach((v, i) => {
        const c = sh.columns[i];
        doc.fillColor('#1f191e').text(v, x + 3, y + 3, { width: widths[i] - 6, align: c.align ?? (c.money ? 'right' : 'left') });
        x += widths[i];
      });
      doc.moveTo(M, y + h).lineTo(M + W, y + h).strokeColor('#d6cdd4').lineWidth(0.5).stroke();
      doc.x = M; doc.y = y + h;
    };
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(10.5).fillColor('#2d0b26').text(sh.name, M);
    doc.moveDown(0.3);
    row(sh.columns.map((c) => c.header), true, '#f6edf3');
    if (!sh.rows.length) { doc.font('Helvetica').fontSize(8).fillColor('#6b5766').text('Tidak ada data.', M); continue; }
    for (const r of sh.rows) row(sh.columns.map((c) => cell(c, r)));
    if (sh.totals) row(sh.columns.map((c) => cell(c, sh.totals)), true);
  }
  if (opt.footnote) doc.moveDown().font('Helvetica').fontSize(7.5).fillColor('#6b5766').text(opt.footnote, M, undefined, { width: W });
  doc.end();
}

export const printedBy = (name: string) => `dicetak ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB oleh ${name}`;
