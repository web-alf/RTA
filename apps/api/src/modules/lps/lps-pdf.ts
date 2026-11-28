import { existsSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';

/**
 * PDF LPS bertema (template gambar + data per santri).
 * Latar = apps/api/assets/lps/template-putra.jpg (opsional template-putri.jpg untuk santri P; bila belum ada, pakai putra).
 * Semua koordinat di file ini dalam PIKSEL GAMBAR TEMPLATE (1024 × 1536), dikonversi ke poin PDF lewat px().
 * Mengganti template dengan desain baru berukuran/berposisi lain = sesuaikan konstanta posisi di bawah.
 */

export type LpsPdfData = {
  fullName: string; nis: string; gender: string | null; className: string; level: string | null; branchName: string;
  period: string; periodLabel: string; yearLabel: string;
  hafalanPercent: number | null; hafalanPosition: string | null;
  scores: Record<string, string>; note: string | null;
  hadir: { H: number; I: number; S: number; A: number };
};

const TW = 1024, TH = 1536;
const PAGE_W = 595.28, K = PAGE_W / TW;
const px = (v: number) => v * K;

const LEVEL: Record<string, string> = { JUZ30: 'Juz 30', JUZ29: 'Juz 29', JUZ28: 'Juz 28' };
const INK = '#2a1f4a', DEEP = '#2e1f5e', MUTED = '#6e6385';
const BADGE: Record<string, { fg: string; bg: string }> = {
  'Sangat baik': { fg: '#2f6b3a', bg: '#e1f0dd' },
  'Baik': { fg: '#8a5a00', bg: '#fcefd0' },
  'Perlu latihan': { fg: '#a8344b', bg: '#fbe1e6' },
};
/** Baris tabel: label, aspek LPS (null = baris hafalan), keterangan. Urutan mengikuti ikon di template. */
const ROWS: { label: string; aspek: string | null; desc?: string }[] = [
  { label: 'Hafalan', aspek: null },
  { label: 'Capaian Juz', aspek: null },
  { label: 'Doa harian', aspek: 'Doa harian', desc: 'Hafalan doa sehari-hari' },
  { label: 'Adab', aspek: 'Adab', desc: 'Sikap & akhlak di kelas' },
  { label: 'Tahsin', aspek: 'Tahsin', desc: 'Perbaikan bacaan' },
  { label: 'BTQ', aspek: 'BTQ', desc: "Baca Tulis Al-Qur'an" },
];
const ROW_Y = [639, 694, 751, 809, 868, 933];
const ID_Y = [274, 316, 357, 399, 441];

function assetDir() {
  // src/modules/lps (Bun) atau dist/src/modules/lps (Node) → apps/api/assets/lps
  const dir = [join(__dirname, '..', '..', '..', 'assets', 'lps'), join(__dirname, '..', '..', '..', '..', 'assets', 'lps')].find((d) => existsSync(d));
  if (!dir) throw new Error('Folder assets/lps tidak ditemukan');
  return dir;
}

const pct1 = (n: number) => n.toFixed(1).replace('.', ',');

export function renderLpsPdf(d: LpsPdfData, out: NodeJS.WritableStream) {
  const dir = assetDir();
  const putri = join(dir, 'template-putri.jpg');
  const bg = d.gender === 'P' && existsSync(putri) ? putri : join(dir, 'template-putra.jpg');

  const doc = new PDFDocument({ size: [PAGE_W, TH * K], margin: 0, info: { Title: `LPS ${d.fullName} ${d.periodLabel}` } });
  doc.registerFont('R', join(dir, 'nunito-400.ttf'));
  doc.registerFont('SB', join(dir, 'nunito-600.ttf'));
  doc.registerFont('B', join(dir, 'nunito-800.ttf'));
  doc.pipe(out);
  doc.image(bg, 0, 0, { width: PAGE_W, height: TH * K });

  /** Tulis teks satu baris; ukuran mengecil otomatis bila melebihi lebar kotak. */
  const text = (s: string, x: number, y: number, o: { f?: string; size?: number; c?: string; w?: number; align?: 'left' | 'center' | 'right'; min?: number } = {}) => {
    let size = o.size ?? 20;
    doc.font(o.f ?? 'SB');
    if (o.w) while (size > (o.min ?? 10) && doc.fontSize(px(size)).widthOfString(s) > px(o.w)) size -= 0.5;
    doc.fontSize(px(size)).fillColor(o.c ?? INK).text(s, px(x), px(y), { lineBreak: false, ...(o.w ? { width: px(o.w), height: px(size * 1.45), ellipsis: true, align: o.align ?? 'left' } : {}) });
  };
  const rrect = (x: number, y: number, w: number, h: number, r: number, color: string) => doc.roundedRect(px(x), px(y), px(w), px(h), px(r)).fill(color);
  const star = (cx: number, cy: number, r: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.48 : r; pts.push([px(cx + rr * Math.cos(a)), px(cy + rr * Math.sin(a))]); }
    doc.polygon(...pts).fill('#f7bb1e');
  };

  // ---------- Header ----------
  text(LEVEL[d.level ?? ''] ?? d.className, 818, 58, { f: 'B', size: 34, c: '#ffffff', w: 124, align: 'center', min: 18 });
  text(d.branchName, 850, 144, { f: 'B', size: 21, c: DEEP, w: 105 });
  text(`Periode ${d.periodLabel}`, 400, 141, { f: 'B', size: 22, c: DEEP, w: 268, align: 'center' });

  // ---------- Identitas ----------
  [d.fullName, d.className, d.branchName, d.nis, d.yearLabel].forEach((v, i) =>
    text(v || '—', 322, ID_Y[i] - 14, { f: i === 0 ? 'B' : 'SB', size: 20, c: INK, w: 310, min: 13 }));
  // baris 4-5: label + ikon sederhana (template asli berisi ustadzah, belum ada di data)
  text('ID Santri', 112, ID_Y[3] - 14, { f: 'SB', size: 19, c: DEEP });
  text('Tahun Ajaran', 112, ID_Y[4] - 14, { f: 'SB', size: 19, c: DEEP });
  rrect(64, ID_Y[3] - 10, 30, 21, 4, '#6b46b8');
  doc.circle(px(73), px(ID_Y[3] - 1), px(4)).fill('#ffffff');
  rrect(80, ID_Y[3] - 4, 9, 3, 1, '#ffffff'); rrect(80, ID_Y[3] + 2, 9, 3, 1, '#ffffff');
  rrect(65, ID_Y[4] - 10, 28, 23, 5, '#6b46b8');
  rrect(65, ID_Y[4] - 10, 28, 7, 3, '#4b2f8f');
  rrect(70, ID_Y[4] + 1, 5, 5, 1, '#ffffff'); rrect(77, ID_Y[4] + 1, 5, 5, 1, '#ffffff'); rrect(84, ID_Y[4] + 1, 5, 5, 1, '#ffffff');

  // ---------- Tabel ----------
  text('MATERI', 40, 576, { f: 'B', size: 19, c: '#ffffff', w: 235, align: 'center' });
  text('KETERANGAN', 279, 576, { f: 'B', size: 19, c: '#ffffff', w: 459, align: 'center' });
  text('NILAI', 742, 576, { f: 'B', size: 19, c: '#ffffff', w: 243, align: 'center' });
  ROWS.forEach((row, i) => {
    const cy = ROW_Y[i];
    text(row.label, 120, cy - 14, { f: 'B', size: 20, c: DEEP, w: 150, min: 14 });
    if (i === 0) {
      text(d.hafalanPosition ?? 'Belum ada setoran tercatat', 294, cy - 13, { f: 'R', size: 19, w: 430, min: 13 });
    } else if (i === 1) {
      if (d.hafalanPercent == null) text('Belum ada data hafalan', 294, cy - 13, { f: 'R', size: 19 });
      else {
        const p = Math.max(0, Math.min(100, d.hafalanPercent)) / 100;
        rrect(294, cy - 7, 200, 14, 7, '#ead0f8');
        if (p > 0) rrect(294, cy - 7, Math.max(14, 200 * p), 14, 7, '#9b6bd6');
        text(`${pct1(d.hafalanPercent)}% dari ${LEVEL[d.level ?? ''] ?? 'juz'}`, 508, cy - 13, { f: 'SB', size: 19, w: 220, min: 13 });
      }
    } else {
      text(row.desc!, 294, cy - 13, { f: 'R', size: 19, w: 430, min: 13 });
    }
    const v = row.aspek ? d.scores?.[row.aspek] : undefined;
    const b = v ? BADGE[v] : undefined;
    if (!b) { text('—', 742, cy - 14, { f: 'B', size: 20, c: MUTED, w: 243, align: 'center' }); return; }
    rrect(760, cy - 18, 208, 36, 18, b.bg);
    doc.circle(px(785), px(cy), px(12)).fill(b.fg);
    if (v === 'Perlu latihan') // panah naik: masih berkembang
      doc.moveTo(px(785), px(cy + 6)).lineTo(px(785), px(cy - 6)).moveTo(px(779), px(cy - 1)).lineTo(px(785), px(cy - 6)).lineTo(px(791), px(cy - 1));
    else doc.moveTo(px(779), px(cy)).lineTo(px(784), px(cy + 5)).lineTo(px(792), px(cy - 5)); // centang
    doc.lineWidth(px(3)).lineCap('round').lineJoin('round').stroke('#ffffff');
    text(v!, 805, cy - 13, { f: 'B', size: 19, c: b.fg, w: 155, min: 13 });
  });

  // ---------- Kehadiran ----------
  const h = d.hadir, total = h.H + h.I + h.S + h.A;
  text(total ? String(h.H) : '—', 112, 1040, { f: 'B', size: 66, c: DEEP, w: 110, align: 'center', min: 36 });
  text(total ? String(total) : '—', 292, 1040, { f: 'B', size: 66, c: DEEP, w: 108, align: 'center', min: 36 });
  rrect(77, 1141, 359, 24, 12, '#ead0f8');
  if (total && h.H) rrect(77, 1141, Math.max(24, (359 * h.H) / total), 24, 12, '#c06ceb');
  if (total) {
    text(`${pct1((h.H / total) * 100)}%`, 77, 1170, { f: 'B', size: 24, c: DEEP });
    text(`Izin ${h.I} · Sakit ${h.S} · Alpa ${h.A}`, 200, 1174, { f: 'SB', size: 16, c: MUTED, w: 236, align: 'right' });
  } else text('Belum ada data absensi bulan ini', 77, 1172, { f: 'SB', size: 16, c: MUTED, w: 359, align: 'center' });

  // ---------- Rekap nilai (pengganti "Nilai Akhir": hanya hitungan, bukan nilai baru) ----------
  text('Rekap Nilai', 586, 1009, { f: 'B', size: 25, c: '#ffffff', w: 136, min: 16 });
  const vals = Object.values(d.scores ?? {});
  Object.entries(BADGE).forEach(([label, b], i) => {
    const y = 1078 + i * 36;
    doc.circle(px(626), px(y + 13), px(8)).fill(b.fg);
    text(label, 644, y, { f: 'B', size: 20, c: b.fg });
    text(`${vals.filter((x) => x === label).length} aspek`, 760, y, { f: 'B', size: 20, c: DEEP, w: 130, align: 'right' });
  });
  [[892, 1072], [610, 1178]].forEach(([x, y]) => star(x, y, 7));

  // ---------- Catatan ----------
  const note = (d.note ?? '').replace(/\n\[Revisi\].*/g, '').trim() || '—';
  const box = { x: 66, y: 1292, w: 724, h: 164 };
  let size = 19;
  doc.font('R');
  while (size > 12 && doc.fontSize(px(size)).heightOfString(note, { width: px(box.w), lineGap: px(2) }) > px(box.h)) size -= 0.5;
  doc.fontSize(px(size)).fillColor(INK).text(note, px(box.x), px(box.y), { width: px(box.w), height: px(box.h), lineGap: px(2), ellipsis: true });

  doc.end();
}
