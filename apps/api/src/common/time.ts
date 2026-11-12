/** Semua tanggal bisnis memakai zona Asia/Jakarta (WIB, UTC+7, tanpa DST). */
const WIB = 7 * 3600_000;
const pad = (n: number) => String(n).padStart(2, '0');
const wibDate = (d = new Date()) => new Date(d.getTime() + WIB);

/** 'YYYY-MM-DD' hari ini di WIB */
export function todayWIB(d = new Date()) { const w = wibDate(d); return `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}`; }
/** 'YYYY-MM-01' bulan berjalan di WIB */
export function monthStart(d = new Date()) { return todayWIB(d).slice(0, 8) + '01'; }
/** Senin pekan berjalan (WIB) */
export function weekStart(d = new Date()) {
  const w = wibDate(d); const dow = (w.getUTCDay() + 6) % 7; // Senin = 0
  const m = new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate() - dow));
  return `${m.getUTCFullYear()}-${pad(m.getUTCMonth() + 1)}-${pad(m.getUTCDate())}`;
}
export function addMonths(ym01: string, n: number) {
  const [y, m] = ym01.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
}
export function addDays(ymd: string, n: number) {
  const [y, m, dd] = ymd.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1, dd + n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
/** 'YYYY-MM-DD' digeser n bulan dengan tanggal yang sama; bila tidak ada (mis. 31 Feb) jadi hari terakhir bulan itu */
export function addMonthsKeepDay(ymd: string, n: number) {
  const [y, m, d] = ymd.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  const t = new Date(Date.UTC(y, m - 1 + n, Math.min(d, last)));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export function monthLabel(ym01: string) { const [y, m] = ym01.split('-').map(Number); return `${BULAN[m - 1]} ${y}`; }
/** Tahun pembelajaran dimulai bulan startM (menu Pengaturan; bawaan Juli). Mengembalikan tgl mulai 'YYYY-MM-01'. */
export function academicYearStart(startM = 7, d = new Date()) {
  const t = todayWIB(d); const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  return `${m >= startM ? y : y - 1}-${pad(startM)}-01`;
}
export const rupiah = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID');
