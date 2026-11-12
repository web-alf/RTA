import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { rupiah } from '../lib/api';
import { Bar, COLOR, StackBar } from './ui';

/** Rupiah ringkas untuk kotak dashboard: Rp19,8 jt · Rp350 rb (nominal lengkap ada di tooltip/aria) */
export function rpShort(n: number) {
  const v = Math.round(Number(n) || 0), a = Math.abs(v), s = v < 0 ? '−' : '';
  const f = (x: number) => x.toLocaleString('id-ID', { maximumSignificantDigits: 3 });
  if (a >= 1e9) return `${s}Rp${f(a / 1e9)} M`;
  if (a >= 1e6) return `${s}Rp${f(a / 1e6)} jt`;
  if (a >= 1e3) return `${s}Rp${f(a / 1e3)} rb`;
  return `${s}Rp${a}`;
}
const Money = ({ v, className = '' }: { v: number; className?: string }) => <b className={`num whitespace-nowrap ${className}`} title={rupiah(v)}>{rpShort(v)}</b>;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

type Tab = 'spp' | 'pendaftaran' | 'kas';
type Finance = {
  label: string;
  spp: null | { tagihan: number; terbayar: number; menunggu: number; belum: number; tunggakan: number; keluargaTunggakan: number; lunas: number; total: number };
  pendaftaran: null | {
    santri: number; target: number; terkumpul: number; menunggu: number; belum: number; lunas: number; cicilan: number; belumBayar: number; buktiDiperiksa: number;
    jatuhTempo: { n: number; amount: number }; terlambat: { n: number; first: { name: string; days: number } | null };
  };
  kas: null | { masuk: number; keluar: number; selisih: number; menunggu: number; menungguNominal: number; belumDibayar: number; keluarTerbesar: { label: string; amount: number }[] };
};

const TABS: { key: Tab; label: string; link: string; to: string }[] = [
  { key: 'spp', label: 'SPP', link: 'Rekap SPP', to: '/spp' },
  { key: 'pendaftaran', label: 'Pendaftaran', link: 'Pendaftaran', to: '/pendaftaran' },
  { key: 'kas', label: 'Kas', link: 'Buka Kas', to: '/kas' },
];

/** Angka utama → batang komposisi → rincian → hal yang perlu ditindaklanjuti */
function Headline({ value, sub }: { value: number; sub: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <Money v={value} className="text-[28px] leading-none text-n-900" />
      <span className="text-[13px] text-n-600">{sub}</span>
    </div>
  );
}
function Legend({ items }: { items: { label: string; value: number; color: string }[] }) {
  return (
    <dl className="space-y-2 text-[13px]">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-2.5 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: i.color }} aria-hidden />
          <dt className="text-n-700 flex-1 min-w-0">{i.label}</dt>
          <dd><Money v={i.value} className="text-n-900" /></dd>
        </div>
      ))}
    </dl>
  );
}
/** Baris tindak lanjut berwarna (nominal/keterangan di kanan) */
function Note({ tone, children, right }: { tone: 'danger' | 'lilac' | 'butter' | 'mint'; children: ReactNode; right: ReactNode }) {
  const cls = { danger: 'bg-danger-bg text-danger-fg', lilac: 'bg-lilac-bg text-lilac-fg', butter: 'bg-butter-bg text-butter-fg', mint: 'bg-mint-bg text-mint-fg' }[tone];
  return (
    <div className={`${cls} rounded-2xl px-4 py-3 flex items-center justify-between gap-3 text-[13px]`}>
      <span className="min-w-0">{children}</span>
      <span className="shrink-0 font-extrabold">{right}</span>
    </div>
  );
}

function SppTab({ s }: { s: NonNullable<Finance['spp']> }) {
  const p = pct(s.terbayar, s.tagihan);
  return (
    <div className="space-y-4">
      <Headline value={s.terbayar} sub={s.tagihan ? `dari ${rpShort(s.tagihan)} · ${p}%` : 'belum ada tagihan bulan ini'} />
      <StackBar h={12} label={`SPP bulan ini: terbayar ${rupiah(s.terbayar)}, menunggu verifikasi ${rupiah(s.menunggu)}, belum bayar ${rupiah(s.belum)} dari ${rupiah(s.tagihan)}`}
        parts={s.tagihan ? [{ value: s.terbayar, color: COLOR.lunas }, { value: s.menunggu, color: COLOR.menunggu }, { value: s.belum, color: COLOR.belum }] : [{ value: 1, color: COLOR.netral }]} />
      <Legend items={[{ label: 'Terbayar', value: s.terbayar, color: COLOR.lunas }, { label: 'Menunggu', value: s.menunggu, color: COLOR.menunggu }, { label: 'Belum bayar', value: s.belum, color: COLOR.belum }]} />
      {s.tunggakan > 0
        ? <Note tone="danger" right={<Money v={s.tunggakan} />}>Tunggakan sebelumnya · {s.keluargaTunggakan} keluarga</Note>
        : <Note tone="mint" right="✓">Tidak ada tunggakan sebelumnya</Note>}
    </div>
  );
}

function PendaftaranTab({ r }: { r: NonNullable<Finance['pendaftaran']> }) {
  if (!r.santri) return <p className="text-sm text-n-600 py-6 text-center">Belum ada santri baru di tahun pembelajaran ini.</p>;
  const p = pct(r.terkumpul, r.target);
  const chips = [
    { n: r.lunas, label: 'lunas', cls: 'bg-mint-bg text-mint-fg' },
    { n: r.cicilan, label: 'mencicil', cls: 'bg-lilac-bg text-lilac-fg' },
    { n: r.belumBayar, label: 'belum DP', cls: 'bg-butter-bg text-butter-fg' },
    { n: r.buktiDiperiksa, label: 'bukti diperiksa', cls: 'bg-n-50 text-brand-800' },
  ].filter((c) => c.n > 0);
  const late = r.terlambat;
  return (
    <div className="space-y-4">
      <Headline value={r.terkumpul} sub={`dari ${rpShort(r.target)} · ${p}% · ${r.santri} santri baru`} />
      <StackBar h={12} label={`Biaya pendaftaran tahun ini: terkumpul ${rupiah(r.terkumpul)}, menunggu verifikasi ${rupiah(r.menunggu)}, belum dibayar ${rupiah(r.belum)} dari ${rupiah(r.target)}`}
        parts={[{ value: r.terkumpul, color: COLOR.lunas }, { value: r.menunggu, color: COLOR.menunggu }, { value: r.belum, color: COLOR.belum }]} />
      <Legend items={[{ label: 'Terkumpul', value: r.terkumpul, color: COLOR.lunas }, { label: 'Menunggu', value: r.menunggu, color: COLOR.menunggu }, { label: 'Belum dibayar', value: r.belum, color: COLOR.belum }]} />
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => <span key={c.label} className={`pill ${c.cls}`}>{c.n} {c.label}</span>)}
        </div>
      )}
      {(r.jatuhTempo.n > 0 || late.n > 0) && (
        <div className="space-y-2">
          {r.jatuhTempo.n > 0 && <Note tone="lilac" right={<Money v={r.jatuhTempo.amount} />}>Jatuh tempo 7 hari ke depan · {r.jatuhTempo.n} cicilan</Note>}
          {late.n > 0 && late.first && (
            <Note tone="danger" right={`lewat ${late.first.days} hari`}>Cicilan terlambat · {late.first.name}{late.n > 1 ? ` +${late.n - 1} lainnya` : ''}</Note>
          )}
        </div>
      )}
    </div>
  );
}

function KasTab({ k }: { k: NonNullable<Finance['kas']> }) {
  const max = Math.max(...k.keluarTerbesar.map((c) => c.amount), 1);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-mint-bg rounded-2xl p-3.5 min-w-0">
          <div className="text-xs text-mint-fg font-semibold">Masuk</div>
          <Money v={k.masuk} className="block text-xl text-n-900 mt-0.5" />
          <div className="text-[11px] text-mint-fg mt-0.5">penjualan barang</div>
        </div>
        <div className="bg-danger-bg rounded-2xl p-3.5 min-w-0">
          <div className="text-xs text-danger-fg font-semibold">Keluar</div>
          <Money v={k.keluar} className="block text-xl text-n-900 mt-0.5" />
          <div className="text-[11px] text-danger-fg mt-0.5">operasional</div>
        </div>
      </div>
      {k.keluarTerbesar.length > 0 ? (
        <div>
          <div className="text-[13px] font-semibold text-n-700 mb-2">Pengeluaran terbesar</div>
          {/* satu grid untuk semua baris agar batang sejajar */}
          <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,10fr)_auto] items-center gap-x-3 gap-y-2.5 text-[13px]">
            {k.keluarTerbesar.map((c) => [
              <span key={`l-${c.label}`} className="text-n-800 truncate" title={c.label}>{c.label}</span>,
              <Bar key={`b-${c.label}`} value={c.amount} max={max} h={8} color={COLOR.tunggakan} label={`${c.label} ${rupiah(c.amount)}`} />,
              <Money key={`v-${c.label}`} v={c.amount} className="text-right" />,
            ])}
          </div>
        </div>
      ) : <p className="text-[13px] text-n-600">Belum ada pengeluaran disetujui bulan ini.</p>}
      {(k.menunggu > 0 || k.belumDibayar > 0) && (
        <div className="space-y-2">
          {k.menunggu > 0 && <Note tone="butter" right={<Money v={k.menungguNominal} />}>{k.menunggu} pengeluaran menunggu PJ</Note>}
          {k.belumDibayar > 0 && <Note tone="lilac" right={<Money v={k.belumDibayar} />}>Barang ditagihkan, belum dibayar</Note>}
        </div>
      )}
    </div>
  );
}

/** Kotak "Keuangan" Beranda: satu kotak, tab per pembukuan (hanya tab yang boleh dilihat). */
export default function KeuanganBox({ f, className = '' }: { f: Finance; className?: string }) {
  const tabs = TABS.filter((t) => f[t.key]);
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? 'spp');
  const cur = tabs.find((t) => t.key === tab) ?? tabs[0];
  if (!cur) return null;
  const bulan = f.label.split(' ')[0].slice(0, 3);
  return (
    <section className={`card p-4 md:p-5 flex flex-col gap-4 min-w-0 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="h2">Keuangan · {bulan}</h2>
        <Link to={cur.to} className="text-[13px] font-semibold text-brand-700 underline underline-offset-2 inline-flex items-center min-h-[44px] -my-3">
          {cur.link}<ChevronRight size={14} aria-hidden />
        </Link>
      </div>
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Pembukuan" className="grid gap-1 p-1 rounded-full bg-n-50" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map((t) => (
            <button key={t.key} role="tab" type="button" aria-selected={t.key === cur.key} onClick={() => setTab(t.key)}
              className={`h-10 rounded-full text-[13px] font-extrabold truncate px-2 transition ${t.key === cur.key ? 'bg-brand-600 text-white shadow-chip' : 'text-brand-800 hover:bg-white'}`}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div role="tabpanel" aria-label={cur.label}>
        {cur.key === 'spp' && <SppTab s={f.spp!} />}
        {cur.key === 'pendaftaran' && <PendaftaranTab r={f.pendaftaran!} />}
        {cur.key === 'kas' && <KasTab k={f.kas!} />}
      </div>
    </section>
  );
}
