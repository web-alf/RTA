import { InputHTMLAttributes, ReactNode, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Search, TriangleAlert, X } from 'lucide-react';

// ---------- Warna pastel bergiliran (avatar, kotak ikon) ----------
export const PASTEL = [
  { bg: 'bg-rose-bg', fg: 'text-rose-fg' }, { bg: 'bg-butter-bg', fg: 'text-butter-fg' },
  { bg: 'bg-lilac-bg', fg: 'text-lilac-fg' }, { bg: 'bg-mint-bg', fg: 'text-mint-fg' },
];
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
export const initials = (name = '') => name.replace(/^(Ustadzah|Kel\.)\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function Avatar({ name, size = 40, square = false }: { name?: string | null; size?: number; square?: boolean }) {
  const p = PASTEL[hash(name ?? '') % 4];
  return <div aria-hidden className={`${p.bg} ${p.fg} ${square ? 'rounded-[30%]' : 'rounded-full'} flex items-center justify-center font-display font-extrabold shrink-0`} style={{ width: size, height: size, fontSize: size * 0.33 }}>{initials(name ?? '')}</div>;
}
export function IconTile({ icon: Icon, tone = 0, size = 40 }: { icon: any; tone?: number; size?: number }) {
  const p = PASTEL[tone % 4];
  return <span className={`${p.bg} ${p.fg} rounded-[14px] inline-flex items-center justify-center shrink-0`} style={{ width: size, height: size }}><Icon size={size * 0.5} aria-hidden /></span>;
}

// ---------- Kerangka ----------
export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-5 md:mb-6">
      <div className="flex-1 min-w-[220px]"><h1 className="h1">{title}</h1>{sub && <div className="text-sm text-n-600 mt-1">{sub}</div>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
export function Card({ children, className = '', title, action, pad = true }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; pad?: boolean }) {
  return (
    <section className={`card ${pad ? 'p-4 md:p-5' : ''} ${className}`}>
      {(title || action) && <div className={`flex items-center justify-between gap-3 ${pad ? 'mb-4' : 'px-4 md:px-5 pt-4 md:pt-5 mb-3'}`}>{title && <h2 className="h2">{title}</h2>}{action}</div>}
      {children}
    </section>
  );
}
export function Stat({ icon: Icon, tone = 0, value, label, onClick, active, filled }: { icon: any; tone?: number; value: ReactNode; label: string; onClick?: () => void; active?: boolean; filled?: boolean }) {
  const Tag: any = onClick ? 'button' : 'div';
  if (filled) { const p = PASTEL[tone % 4]; return (
    <Tag onClick={onClick} className={`${p.bg} rounded-card p-4 text-left flex items-center gap-3 min-w-0 ${onClick ? 'hover:-translate-y-0.5 transition' : ''} ${active ? 'ring-2 ring-brand-600' : ''}`}>
      <span className={`bg-white ${p.fg} rounded-[14px] inline-flex items-center justify-center shrink-0 w-11 h-11`}><Icon size={20} aria-hidden /></span>
      <div className="min-w-0"><div className="num text-2xl leading-none text-n-900">{value}</div><div className={`text-xs mt-1.5 ${p.fg}`}>{label}</div></div>
    </Tag>); }
  const icon = Icon;
  return (
    <Tag onClick={onClick} className={`card p-4 text-left flex flex-col gap-3 ${onClick ? 'hover:-translate-y-0.5 transition' : ''} ${active ? 'ring-2 ring-brand-600' : ''}`}>
      <IconTile icon={icon} tone={tone} />
      <div><div className="num text-2xl leading-none">{value}</div><div className="text-xs text-n-600 mt-1.5">{label}</div></div>
    </Tag>
  );
}
export function Empty({ text, action, icon: Icon }: { text: string; action?: ReactNode; icon?: any }) {
  return <div className="text-center py-12 px-4 text-sm text-n-600">{Icon && <div className="mx-auto mb-3 w-12 h-12 rounded-2xl bg-n-50 text-brand-700 flex items-center justify-center"><Icon size={22} /></div>}{text}{action && <div className="mt-4">{action}</div>}</div>;
}

// ---------- Form ----------
export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && !error && <p className="mt-1.5 text-xs text-n-600">{hint}</p>}
      {error && <p className="mt-1.5 text-xs text-danger-fg flex items-center gap-1"><AlertCircle size={12} /> {error}</p>}
    </div>
  );
}
/** Input password dengan tombol lihat/sembunyikan. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={show ? 'text' : 'password'} className={`input pr-12 ${props.className ?? ''}`} />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Sembunyikan password' : 'Lihat password'} aria-pressed={show} className="absolute right-0 top-0 h-full w-11 grid place-items-center text-n-600 hover:text-n-900">
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
export function SearchBox({ value, onChange, placeholder, className = '' }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <label className={`flex items-center gap-2 h-12 md:h-11 px-4 rounded-2xl bg-white shadow-soft text-n-600 ${className}`}>
      <Search size={18} aria-hidden />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="flex-1 min-w-0 bg-transparent outline-none text-sm text-n-900 placeholder:text-n-500" />
    </label>
  );
}
export function Chips<T extends string>({ items, value, onChange, label }: { items: { value: T; label: string; n?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="scroll-x">
      {items.map((i) => <button key={i.value} type="button" aria-pressed={value === i.value} onClick={() => onChange(i.value)} className={value === i.value ? 'chip-on' : 'chip-off'}>{i.label}{i.n != null && <span className="opacity-75">· {i.n}</span>}</button>)}
    </div>
  );
}
export function Segmented<T extends string>({ items, value, onChange, label }: { items: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex gap-1 p-1 rounded-full bg-white shadow-soft max-w-full overflow-x-auto">
      {items.map((i) => <button key={i.value} role="tab" type="button" aria-selected={value === i.value} onClick={() => onChange(i.value)} className={`h-9 px-4 rounded-full text-[13px] font-extrabold whitespace-nowrap ${value === i.value ? 'bg-brand-600 text-white' : 'text-brand-800 hover:bg-n-50'}`}>{i.label}</button>)}
    </div>
  );
}
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={`w-12 h-7 rounded-full p-[3px] flex transition shrink-0 ${checked ? 'bg-brand-600 justify-end' : 'bg-n-300 justify-start'}`}>
      <span className="w-[22px] h-[22px] rounded-full bg-white shadow" />
    </button>
  );
}
export function Alert({ kind = 'danger', children }: { kind?: 'danger' | 'success' | 'info' | 'warning'; children: ReactNode }) {
  const map = { danger: 'bg-danger-bg text-danger-fg', success: 'bg-success-bg text-success-fg', info: 'bg-info-bg text-info-fg', warning: 'bg-warning-bg text-warning-fg' };
  const Icon = kind === 'success' ? CheckCircle2 : kind === 'warning' ? TriangleAlert : AlertCircle;
  return <div role={kind === 'danger' ? 'alert' : 'status'} className={`flex gap-2.5 items-start text-sm rounded-2xl px-4 py-3 ${map[kind]}`}><Icon size={18} className="mt-px shrink-0" /><div>{children}</div></div>;
}

// ---------- Status ----------
const S: Record<string, [string, string]> = {
  AKTIF: ['bg-mint-bg text-mint-fg', 'Aktif'], INDENT: ['bg-lilac-bg text-lilac-fg', 'Indent'], CUTI: ['bg-butter-bg text-butter-fg', 'Cuti'], KELUAR: ['bg-n-100 text-n-700', 'Keluar'],
  MENUNGGU: ['bg-lilac-bg text-lilac-fg', 'Menunggu'], DISETUJUI: ['bg-butter-bg text-butter-fg', 'Disetujui'], DITOLAK: ['bg-danger-bg text-danger-fg', 'Ditolak'], DITARIK: ['bg-n-100 text-n-700', 'Ditarik'],
  LUNAS: ['bg-mint-bg text-mint-fg', 'Lunas'], BELUM: ['bg-butter-bg text-butter-fg', 'Belum bayar'], TUNGGAKAN: ['bg-danger-bg text-danger-fg', 'Tunggakan'], TIDAK_DITAGIH: ['bg-n-100 text-n-700', 'Tidak ditagih'],
  TERJADWAL: ['bg-n-100 text-n-700', 'Terjadwal'], CICILAN: ['bg-lilac-bg text-lilac-fg', 'Cicilan berjalan'], TERLAMBAT: ['bg-danger-bg text-danger-fg', 'Terlambat'], BELUM_BAYAR: ['bg-butter-bg text-butter-fg', 'Belum bayar'],
  TERVERIFIKASI: ['bg-mint-bg text-mint-fg', 'Terverifikasi'], DIBATALKAN: ['bg-n-100 text-n-700', 'Dibatalkan'],
  DRAFT: ['bg-n-100 text-brand-800', 'Draft'], DIPERIKSA: ['bg-lilac-bg text-lilac-fg', 'Diperiksa'], TERBIT: ['bg-mint-bg text-mint-fg', 'Terbit'],
  SUDAH: ['bg-mint-bg text-mint-fg', 'Sudah'], SELESAI: ['bg-mint-bg text-mint-fg', 'Selesai'], BERJALAN: ['bg-lilac-bg text-lilac-fg', 'Sedang dihafal'], TETAP: ['bg-danger-bg text-danger-fg', 'Tidak bertambah'],
};
export function Badge({ status, label }: { status: string; label?: string }) {
  const [cls, l] = S[status] ?? ['bg-n-100 text-n-700', status];
  return <span className={`pill ${cls}`}><span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />{label ?? l}</span>;
}

// ---------- Grafik ringan (SVG, tanpa pustaka) ----------
export function Ring({ segments, size = 120, stroke = 16, center, sub, label, textColor = '#2d0b26', track = '#f6edf3' }: { segments: { value: number; color: string }[]; size?: number; stroke?: number; center?: ReactNode; sub?: string; label: string; textColor?: string; track?: string }) {
  const r = (size - stroke) / 2, C = 2 * Math.PI * r, total = segments.reduce((a, s) => a + s.value, 0) || 1;
  let off = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {segments.map((s, i) => { const len = (s.value / total) * C; const el = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke} strokeDasharray={`${len} ${C}`} strokeDashoffset={-off} />; off += len; return el; })}
      </g>
      {center != null && <text x="50%" y={sub ? '48%' : '54%'} textAnchor="middle" fontFamily="Nunito, sans-serif" fontWeight={900} fontSize={size * 0.19} fill={textColor}>{center}</text>}
      {sub && <text x="50%" y="64%" textAnchor="middle" fontSize={size * 0.09} fill="#6b5766">{sub}</text>}
    </svg>
  );
}
export function StackBar({ parts, h = 12, label }: { parts: { value: number; color: string }[]; h?: number; label: string }) {
  const t = parts.reduce((a, p) => a + p.value, 0) || 1;
  return <div role="img" aria-label={label} className="flex gap-[3px] w-full" style={{ height: h }}>{parts.filter((p) => p.value > 0).map((p, i) => <div key={i} className="rounded-full" style={{ width: `${(p.value / t) * 100}%`, background: p.color }} />)}</div>;
}
export function Bar({ value, max = 100, color = '#ad1d8e', h = 10, label }: { value: number; max?: number; color?: string; h?: number; label?: string }) {
  return <div role={label ? 'img' : undefined} aria-label={label} className="w-full rounded-full bg-n-100" style={{ height: h }}><div className="rounded-full h-full" style={{ width: `${Math.min(100, (value / (max || 1)) * 100)}%`, background: color }} /></div>;
}
export function Spark({ values, w = 72, h = 26, color = '#ad1d8e', label }: { values: number[]; w?: number; h?: number; color?: string; label: string }) {
  const lo = Math.min(...values), hi = Math.max(...values), span = Math.max(hi - lo, 1);
  const pts = values.map((v, i) => `${4 + (i * (w - 8)) / Math.max(values.length - 1, 1)},${h - 4 - ((v - lo) / span) * (h - 8)}`).join(' ');
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}><polyline points={pts} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
export const COLOR = { lunas: '#5fb38a', menunggu: '#8b74d9', belum: '#f2c766', tunggakan: '#e46a5a', brand: '#ad1d8e', netral: '#e8dde4', rose: '#f4c3e9' };

// ---------- Overlay ----------
function useEsc(open: boolean, onClose: () => void) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); if (open) { window.addEventListener('keydown', k); document.body.style.overflow = 'hidden'; } return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; }; }, [open, onClose]);
}
/** Dialog: di tengah (desktop) / sheet dari bawah (HP) */
export function Dialog({ open, onClose, title, children, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string }) {
  useEsc(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-[rgba(45,11,38,.45)]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`bg-page w-full ${width} max-h-[92vh] overflow-auto rounded-t-[32px] sm:rounded-[28px] shadow-float pb-[env(safe-area-inset-bottom)]`} onClick={(e) => e.stopPropagation()}>
        <div className="sm:hidden mx-auto mt-3 w-11 h-1.5 rounded-full bg-n-300" />
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2"><h2 className="font-display font-black text-xl">{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Tutup"><X size={18} /></button></div>
        <div className="px-5 pb-6 pt-2">{children}</div>
      </div>
    </div>
  );
}
/** Panel geser: dari kanan (desktop) / sheet penuh dari bawah (HP) */
export function Drawer({ open, onClose, title, sub, children, footer, badge }: { open: boolean; onClose: () => void; title: string; sub?: ReactNode; children: ReactNode; footer?: ReactNode; badge?: ReactNode }) {
  useEsc(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-[rgba(45,11,38,.42)]" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="absolute bg-page flex flex-col shadow-float inset-x-0 bottom-0 top-8 rounded-t-[32px] md:inset-y-0 md:left-auto md:right-0 md:top-0 md:w-[560px] md:rounded-l-[32px] md:rounded-tr-none">
        <div className="md:hidden mx-auto mt-3 w-11 h-1.5 rounded-full bg-n-300" />
        <header className="flex items-start gap-3 px-5 md:px-7 pt-4 md:pt-7 pb-4">
          <div className="flex-1 min-w-0">{badge}<h2 className={`font-display font-black text-xl md:text-[22px] ${badge ? 'mt-2' : ''}`}>{title}</h2>{sub && <div className="text-sm text-n-600 mt-1">{sub}</div>}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Tutup"><X size={18} /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 md:px-7 pb-4 space-y-5">{children}</div>
        {footer && <footer className="px-5 md:px-7 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] md:pb-7 bg-white md:bg-transparent rounded-t-3xl md:rounded-none shadow-up md:shadow-none">{footer}</footer>}
      </section>
    </div>
  );
}
export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return <div className="card px-4">{rows.map(([k, v], i) => <div key={k} className={`flex justify-between gap-4 py-3 text-sm ${i < rows.length - 1 ? 'border-b border-n-100' : ''}`}><span className="text-n-600">{k}</span><b className="font-semibold text-right">{v}</b></div>)}</div>;
}
