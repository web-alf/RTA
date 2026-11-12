import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, CalendarDays, FileText, TrendingUp } from 'lucide-react';
import { get, tgl } from '../lib/api';
import { Alert, Badge, Bar, Card, COLOR, Empty, IconTile, PageHeader, Ring, Segmented } from '../components/ui';

/** Portal akun wali: progres hafalan & nilai LPS terbit tiap anak selama tahun pembelajaran berjalan. */
const LEVEL: Record<string, string> = { JUZ30: 'Juz 30', JUZ29: 'Juz 29', JUZ28: 'Juz 28' };
const NILAI: Record<string, string> = { 'Sangat baik': 'bg-mint-bg text-mint-fg', Baik: 'bg-butter-bg text-butter-fg', 'Perlu latihan': 'bg-rose-bg text-rose-fg' };
const ASPEK = ['BTQ', 'Tahsin', 'Adab', 'Doa harian'];
const pct = (n: number | null | undefined) => (n == null ? '-' : `${Math.round(n * 10) / 10}%`);

/** Grafik garis capaian (0–100%) per pekan; sumbu x = urutan pekan tercatat. */
function TrendChart({ points, label }: { points: { weekStart: string; percent: number }[]; label: string }) {
  const W = 640, H = 200, L = 34, R = 10, T = 10, B = 26;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(points.length - 1, 1);
  const y = (v: number) => T + (1 - v / 100) * (H - T - B);
  const line = points.map((p, i) => `${x(i)},${y(p.percent)}`).join(' ');
  const area = `${x(0)},${y(0)} ${line} ${x(points.length - 1)},${y(0)}`;
  const ticks = points.length <= 6 ? points.map((_, i) => i) : [0, Math.round((points.length - 1) / 2), points.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="w-full h-auto">
      {[0, 25, 50, 75, 100].map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={COLOR.netral} strokeDasharray={v ? '4 4' : undefined} /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="currentColor" className="text-n-600">{v}</text></g>)}
      <polygon points={area} fill={COLOR.rose} opacity={0.45} />
      <polyline points={line} fill="none" stroke={COLOR.brand} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.percent)} r={points.length > 20 ? 0 : 4} fill={COLOR.brand} />)}
      {ticks.map((i) => <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} fontSize={11} fill="currentColor" className="text-n-600">{tgl(points[i].weekStart)}</text>)}
    </svg>
  );
}

export default function Perkembangan() {
  const q = useQuery({ queryKey: ['portal', 'perkembangan'], queryFn: () => get('/portal/perkembangan') });
  const [sel, setSel] = useState<string>('');
  if (q.error) return <div className="space-y-5"><PageHeader title="Anak Saya" /><Alert>{(q.error as any).message}</Alert></div>;
  if (!q.data) return <p className="text-sm text-n-600">Memuat…</p>;
  const { kids, yearLabel, yearStart } = q.data;
  const head = <PageHeader title="Anak Saya" sub={`Perjalanan hafalan dan laporan perkembangan putra-putri Bapak/Ibu selama tahun pembelajaran ${yearLabel}.`} />;
  if (!kids.length) return <div className="space-y-5">{head}<Card><Empty icon={TrendingUp} text="Belum ada data santri yang terhubung ke akun ini. Silakan hubungi PJ RTA." /></Card></div>;
  const k = kids.find((x: any) => String(x.id) === sel) ?? kids[0];
  const levelName = LEVEL[k.level] ?? k.level;
  const pts = k.weeks.filter((w: any) => w.level === k.level);
  const gain = k.current && k.startPercent != null && pts.length ? Math.max(0, k.current.percent - k.startPercent) : null;
  const done = k.surahs.filter((s: any) => s.state === 'SELESAI').length;
  const movedUp = k.weeks.some((w: any) => w.level !== k.level);

  return (
    <div className="space-y-6">
      {head}
      {kids.length > 1 && <Segmented label="Pilih anak" value={String(k.id)} onChange={setSel} items={kids.map((x: any) => ({ value: String(x.id), label: x.nickname }))} />}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-5 items-start">
        <Card title="Capaian hafalan">
          {!k.current ? <Empty icon={BookOpen} text={`Capaian hafalan ${k.nickname} belum tercatat tahun ini. Insya Allah segera diisi oleh ustadzah.`} /> : <>
            <div className="flex items-center gap-4">
              <Ring size={120} segments={[{ value: k.current.percent, color: COLOR.brand }, { value: Math.max(0, 100 - k.current.percent), color: 'transparent' }]} center={pct(k.current.percent)} sub={levelName}
                label={`Capaian hafalan ${k.nickname} ${pct(k.current.percent)} dari ${levelName}`} />
              <div className="min-w-0 space-y-1">
                <div className="font-bold text-lg truncate">{k.fullName}</div>
                <div className="text-sm text-n-600">{k.className}</div>
                <div className="text-sm">Posisi terakhir: <b>{k.current.surah} ayat {k.current.ayat}</b></div>
                <div className="text-xs text-n-600">Dicatat pekan {tgl(k.current.weekStart)}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-5 text-center">
              <div className="rounded-2xl bg-mint-bg text-mint-fg p-3"><div className="num text-xl">{gain == null ? '-' : `+${pct(gain)}`}</div><div className="text-[11px] font-semibold">sejak awal tahun</div></div>
              <div className="rounded-2xl bg-lilac-bg text-lilac-fg p-3"><div className="num text-xl">{done}/{k.surahs.length}</div><div className="text-[11px] font-semibold">surah selesai</div></div>
              <div className="rounded-2xl bg-butter-bg text-butter-fg p-3"><div className="num text-xl">{k.weeks.length}</div><div className="text-[11px] font-semibold">pekan tercatat</div></div>
            </div>
            {movedUp && <p className="mt-4 text-sm text-n-700">Alhamdulillah, tahun ini {k.nickname} sudah melanjutkan ke {levelName}. Grafik menampilkan capaian di {levelName}.</p>}
          </>}
        </Card>

        <Card title="Grafik capaian per pekan" action={<span className="text-xs text-n-600 flex items-center gap-1"><CalendarDays size={14} />sejak {tgl(yearStart)}</span>}>
          {pts.length < 2 ? <Empty icon={TrendingUp} text="Grafik tampil setelah capaian tercatat minimal dua pekan." />
            : <TrendChart points={pts} label={`Grafik capaian hafalan ${k.nickname} di ${levelName}: dari ${pct(pts[0].percent)} pada ${tgl(pts[0].weekStart)} menjadi ${pct(pts[pts.length - 1].percent)} pada ${tgl(pts[pts.length - 1].weekStart)}`} />}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <Card title={`Peta surah ${levelName}`}>
          <ul className="divide-y divide-n-100 -my-2">
            {k.surahs.map((s: any) => (
              <li key={s.name} className="py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2"><span className="font-semibold truncate">{s.name}</span><span className="text-xs text-n-600 shrink-0">{s.ayat}/{s.ayatCount} ayat</span></div>
                  <div className="mt-1.5"><Bar value={s.ayat} max={s.ayatCount} h={8} color={s.state === 'SELESAI' ? COLOR.lunas : COLOR.brand} label={`${s.name}: ${s.ayat} dari ${s.ayatCount} ayat`} /></div>
                </div>
                <span className="w-[118px] flex justify-end shrink-0"><Badge status={s.state} label={s.state === 'BELUM' ? 'Belum dimulai' : undefined} /></span>
              </li>))}
          </ul>
        </Card>

        <Card title="Nilai LPS tahun ini">
          {!k.lps.length ? <Empty icon={FileText} text="Belum ada LPS yang terbit tahun ini. LPS lengkap bisa diunduh di menu Tagihan." /> : <>
            <div className="hidden md:block scroll-x">
              <table className="w-full text-sm">
                <thead><tr><th className="th">Aspek</th>{k.lps.map((r: any) => <th key={r.period} className="th">{r.label}</th>)}</tr></thead>
                <tbody>
                  {ASPEK.map((a) => <tr key={a}><td className="td font-semibold">{a}</td>{k.lps.map((r: any) => <td key={r.period} className="td">{r.scores[a] ? <span className={`pill ${NILAI[r.scores[a]] ?? 'bg-n-100 text-n-700'}`}>{r.scores[a]}</span> : '-'}</td>)}</tr>)}
                  <tr><td className="td font-semibold">Hafalan</td>{k.lps.map((r: any) => <td key={r.period} className="td num">{pct(r.hafalanPercent)}</td>)}</tr>
                </tbody>
              </table>
            </div>
            <div className="md:hidden space-y-3">
              {[...k.lps].reverse().map((r: any) => (
                <div key={r.period} className="rounded-2xl bg-n-50 p-4">
                  <div className="flex items-center gap-3 mb-3"><IconTile icon={FileText} tone={3} /><div><div className="font-bold">{r.label}</div><div className="text-xs text-n-600">Hafalan {pct(r.hafalanPercent)}</div></div></div>
                  <dl className="grid grid-cols-2 gap-2">{ASPEK.map((a) => <div key={a}><dt className="text-xs text-n-600">{a}</dt><dd>{r.scores[a] ? <span className={`pill ${NILAI[r.scores[a]] ?? 'bg-n-100 text-n-700'}`}>{r.scores[a]}</span> : '-'}</dd></div>)}</dl>
                </div>))}
            </div>
          </>}
        </Card>
      </div>
    </div>
  );
}
