import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, CheckCircle2, Clock, Lock, Minus, Plus, TrendingUp } from 'lucide-react';
import { ApiError, can, get, post, tgl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { Alert, Avatar, Badge, Bar, Card, Chips, Dialog, Drawer, Empty, IconTile, PageHeader, Ring, SearchBox, Spark } from '../components/ui';

type Row = { id: number; nis: string; fullName: string; status: string; position: string | null; total: number; percent: number; week: string; delta: number | null; trend: number[] };
const WEEK_LABEL: Record<string, string> = { SUDAH: '', BELUM: 'Belum diinput', TETAP: 'Tidak bertambah 2 pekan', CUTI: 'Cuti' };
const fmt = (n: number) => String(n).replace('.', ',');

export default function Kelas() {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const classes = useQuery({ queryKey: ['hafalan-classes'], queryFn: () => get('/hafalan/classes') });
  const scoped = !!user?.branchIds;
  const classId = Number(sp.get('c')) || (scoped ? classes.data?.[0]?.id : undefined);
  const roster = useQuery({ queryKey: ['roster', classId], queryFn: () => get(`/hafalan/classes/${classId}`), enabled: !!classId });
  const PASTEL_BG = ['bg-rose-bg', 'bg-butter-bg', 'bg-lilac-bg', 'bg-mint-bg']; const PASTEL_FG = ['text-rose-fg', 'text-butter-fg', 'text-lilac-fg', 'text-mint-fg']; const PASTEL_BAR = ['#ad1d8e', '#d9a52f', '#8b74d9', '#5fb38a'];
  const [filter, setFilter] = useState<'ALL' | 'BELUM' | 'SUDAH' | 'TETAP'>('ALL');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<number | null>(null);
  const [sheet, setSheet] = useState(false);
  const canInput = can(user, 'kelas.input');
  const r = roster.data;
  const rows: Row[] = useMemo(() => (r?.rows ?? []).filter((x: Row) => (filter === 'ALL' || x.week === filter || (filter === 'SUDAH' && x.week === 'TETAP')) && x.fullName.toLowerCase().includes(q.toLowerCase())), [r, filter, q]);
  useEffect(() => { if (r && !sel) setSel(r.rows.find((x: Row) => x.week === 'BELUM')?.id ?? r.rows.find((x: Row) => x.status === 'AKTIF')?.id ?? null); }, [r, sel]);
  const current = r?.rows.find((x: Row) => x.id === sel) as Row | undefined;
  const pick = (id: number) => { setSel(id); if (window.matchMedia('(max-width: 1023px)').matches) setSheet(true); };
  const next = () => { const list: Row[] = r.rows.filter((x: Row) => x.status === 'AKTIF'); const i = list.findIndex((x) => x.id === sel); const n = list.slice(i + 1).find((x) => x.week === 'BELUM') ?? list.find((x) => x.week === 'BELUM' && x.id !== sel); if (n) setSel(n.id); else setSheet(false); };
  const ws = r?.weekStart ? new Date(r.weekStart) : null;
  const weekLabel = ws ? `${ws.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} – ${new Date(ws.getTime() + 6 * 864e5).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}` : '';

  return (
    <div>
      <PageHeader title="Kelas & hafalan" sub={weekLabel && `Pekan berjalan · ${weekLabel}`}
        actions={user?.branchIds && <span className="pill h-10 px-4 bg-white text-brand-800 shadow-soft"><Lock size={14} />Cabang Anda</span>} />
      {classes.data?.length === 0 && <Card><Empty icon={BookOpen} text="Belum ada kelas di cabang Anda." /></Card>}

      {/* PJ / Manajer: kisi semua kelas dulu */}
      {!scoped && !classId && classes.data && <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {classes.data.map((c: any, i: number) => { const pct = c.aktif ? Math.round((c.doneThisWeek / c.aktif) * 100) : 0; return (
          <article key={c.id} className={`rounded-card p-5 flex flex-col gap-3 ${PASTEL_BG[i % 4]}`}>
            <div className="flex justify-between items-start"><div><div className="text-xs text-n-700">{c.branchName}</div><div className="font-display font-black text-2xl">{c.level.replace('JUZ', 'Juz ')}</div></div><span className={`pill bg-white ${PASTEL_FG[i % 4]}`}>{c.aktif} santri</span></div>
            <div><div className="flex justify-between text-xs text-n-800"><span>Rata-rata capaian</span><b>{Math.round(c.avgPercent)}%</b></div><div className="h-2 rounded-full bg-white/80 mt-1.5"><div className="h-2 rounded-full" style={{ width: `${c.avgPercent}%`, background: PASTEL_BAR[i % 4] }} /></div></div>
            <div className="flex justify-between items-center text-xs text-n-700"><span>{c.doneThisWeek}/{c.aktif} diinput pekan ini{pct === 100 ? ' ✓' : ''}</span><button onClick={() => { setSp({ c: String(c.id) }); setSel(null); }} className={`font-bold ${PASTEL_FG[i % 4]}`}>{canInput ? 'Input ›' : 'Lihat ›'}</button></div>
          </article>); })}
      </div>}
      {!scoped && classId && <button onClick={() => { setSp({}); setSel(null); }} className="text-sm font-semibold mb-3">‹ Semua kelas</button>}
      <div role="tablist" aria-label="Pilih kelas" className={`flex gap-3 overflow-x-auto -mx-4 px-4 pb-3 md:mx-0 md:px-0 mb-3 ${!scoped && !classId ? 'hidden' : ''}`}>
        {classes.data?.map((c: any) => { const on = c.id === classId; const pct = c.aktif ? Math.round((c.doneThisWeek / c.aktif) * 100) : 0; return (
          <button key={c.id} role="tab" aria-selected={on} onClick={() => { setSp({ c: String(c.id) }); setSel(null); }}
            className={`shrink-0 w-[260px] text-left rounded-card p-4 flex items-center gap-4 transition ${on ? 'bg-brand-600 text-white shadow-brand' : 'bg-white shadow-card hover:-translate-y-0.5'}`}>
            <Ring size={64} stroke={9} textColor={on ? '#ffffff' : '#2d0b26'} track={on ? 'rgba(255,255,255,.25)' : '#f1e3ec'} label={`Rata-rata capaian ${c.avgPercent}%`} center={`${Math.round(c.avgPercent)}%`} segments={[{ value: c.avgPercent, color: on ? '#fff' : '#8b74d9' }, { value: 100 - c.avgPercent, color: 'transparent' }]} />
            <div className="flex-1 min-w-0"><div className="font-display font-black text-xl truncate">{c.level.replace('JUZ', 'Juz ')}</div><div className={`text-xs truncate ${on ? 'text-white/85' : 'text-n-600'}`}>{user?.branchIds?.length === 1 ? '' : `${c.branchName} · `}{c.aktif} santri aktif{c.cuti ? ` · ${c.cuti} cuti` : ''}</div>
              <div className={`mt-2 h-2 rounded-full ${on ? 'bg-white/25' : 'bg-n-100'}`}><div className={`h-2 rounded-full ${on ? 'bg-white' : 'bg-lilac-solid'}`} style={{ width: `${pct}%` }} /></div><div className="text-xs font-bold mt-1">{c.doneThisWeek}/{c.aktif} diinput pekan ini</div></div>
          </button>); })}
      </div>

      {r && <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
        <div className="space-y-5 min-w-0">
          {canInput && <section className="md:hidden rounded-card p-4 bg-brand-600 text-white shadow-brand space-y-3">
            <div className="flex justify-between items-baseline"><span className="text-sm text-white/90">Input pekan ini</span><span className="num text-2xl">{r.summary.done} / {r.summary.aktif}</span></div>
            <div className="h-2.5 rounded-full bg-white/25"><div className="h-2.5 rounded-full bg-white" style={{ width: `${r.summary.aktif ? (r.summary.done / r.summary.aktif) * 100 : 0}%` }} /></div>
            {r.summary.todo > 0 ? <button className="btn w-full bg-white text-brand-700" onClick={() => { const n = r.rows.find((x: Row) => x.week === 'BELUM'); if (n) { setSel(n.id); setSheet(true); } }}>Lanjut input {r.summary.todo} santri tersisa ›</button> : <div className="text-sm font-semibold">Semua santri sudah diinput pekan ini ✓</div>}
          </section>}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {[[CheckCircle2, 3, r.summary.done, 'Sudah diinput'], [Clock, 1, r.summary.todo, 'Belum diinput'], [AlertTriangle, 0, r.summary.flat, 'Tidak bertambah 2 pekan'], [TrendingUp, 2, `+${r.summary.avgDelta}`, 'Rata-rata ayat pekan ini']].map(([I, t, v, l]: any) => (
              <div key={l} className="card p-4 flex items-center gap-3"><IconTile icon={I} tone={t} /><div><div className="num text-xl leading-none">{v}</div><div className="text-xs text-n-600 mt-1">{l}</div></div></div>))}
          </div>
          <Card pad={false} className="pb-2">
            <div className="px-4 md:px-5 pt-4 md:pt-5 space-y-3">
              <div className="flex flex-wrap items-center gap-3"><h2 className="h2 flex-1">Daftar santri {r.class.name}</h2><SearchBox value={q} onChange={setQ} placeholder="Cari santri" className="w-full sm:w-64 !h-10 !shadow-none bg-n-50" /></div>
              <Chips label="Filter status input" value={filter} onChange={setFilter} items={[{ value: 'ALL', label: 'Semua', n: r.summary.aktif }, { value: 'BELUM', label: 'Belum diinput', n: r.summary.todo }, { value: 'SUDAH', label: 'Sudah diinput', n: r.summary.done }, { value: 'TETAP', label: 'Perlu perhatian', n: r.summary.flat }]} />
            </div>
            {rows.length === 0 ? <Empty text="Tidak ada santri yang cocok." /> : <>
              {/* Tabel (≥ md) */}
              <div className="hidden md:block overflow-x-auto mt-2">
                <table className="w-full min-w-[720px]"><thead><tr><th className="th pl-5">Santri</th><th className="th">Posisi terakhir</th><th className="th">Capaian</th><th className="th">Pekan ini</th><th className="th">4 pekan</th><th className="th pr-5" /></tr></thead>
                  <tbody>{rows.map((x) => (
                    <tr key={x.id} className={`${x.id === sel ? 'bg-brand-50' : ''} ${x.status === 'CUTI' ? 'opacity-60' : ''}`}>
                      <td className="td pl-5"><div className="flex items-center gap-3"><Avatar name={x.fullName} /><div><div className="font-semibold">{x.fullName}</div><div className="text-xs text-n-600">{x.nis}</div></div></div></td>
                      <td className="td"><div className="font-semibold">{x.position ?? '—'}</div><div className="text-xs text-n-600">{x.total} dari {r.juzTotal} ayat</div></td>
                      <td className="td"><div className="flex items-center gap-2.5"><div className="w-24"><Bar value={x.percent} h={8} /></div><b className="num">{fmt(x.percent)}%</b></div></td>
                      <td className="td"><Badge status={x.week === 'TETAP' ? 'TETAP' : x.week === 'CUTI' ? 'CUTI' : x.week === 'BELUM' ? 'BELUM' : 'SUDAH'} label={x.week === 'SUDAH' ? `+${x.delta} ayat` : x.week === 'TETAP' ? '+0 · 2 pekan' : WEEK_LABEL[x.week]} /></td>
                      <td className="td"><Spark values={x.trend} color={x.week === 'TETAP' ? '#e46a5a' : x.status === 'CUTI' ? '#c9bcc5' : '#ad1d8e'} label={`Ayat 4 pekan: ${x.trend.join(', ')}`} /></td>
                      <td className="td pr-5 text-right">{canInput && x.status === 'AKTIF' && <button onClick={() => pick(x.id)} className={x.week === 'BELUM' || x.week === 'TETAP' ? 'btn-primary !h-9' : 'btn-soft !h-9'}>{x.week === 'BELUM' || x.week === 'TETAP' ? 'Input' : 'Ubah'}</button>}</td>
                    </tr>))}</tbody></table>
              </div>
              {/* Kartu (HP) */}
              <div className="md:hidden px-4 pt-2 space-y-3">{rows.map((x) => (
                <button key={x.id} disabled={!canInput || x.status !== 'AKTIF'} onClick={() => pick(x.id)} className={`w-full card flex items-center gap-3 px-4 min-h-[72px] text-left ${x.status === 'CUTI' ? 'opacity-60' : ''}`}>
                  <Avatar name={x.fullName} /><div className="flex-1 min-w-0"><div className="font-bold text-sm truncate">{x.fullName}</div><div className="text-xs text-n-600 truncate">{x.position ?? 'Belum ada catatan'} · {fmt(x.percent)}%</div></div>
                  <Badge status={x.week === 'SUDAH' ? 'SUDAH' : x.week} label={x.week === 'SUDAH' ? `+${x.delta}` : x.week === 'BELUM' ? 'Belum' : x.week === 'TETAP' ? '2 pekan tetap' : 'Cuti'} /></button>))}</div>
            </>}
          </Card>
        </div>
        {canInput && current && <aside className="hidden lg:block sticky top-8"><InputPanel key={current.id} row={current} level={r.class.level} juzTotal={r.juzTotal} index={r.rows.filter((x: Row) => x.status === 'AKTIF').findIndex((x: Row) => x.id === current.id) + 1} count={r.summary.aktif} onDone={next} /></aside>}
      </div>}

      {canInput && current && <Drawer open={sheet} onClose={() => setSheet(false)} title="Input hafalan" sub={`${r?.class.name} · pekan berjalan`}>
        <InputPanel key={`m${current.id}`} row={current} level={r.class.level} juzTotal={r.juzTotal} index={0} count={0} onDone={next} bare />
      </Drawer>}
    </div>
  );
}

function InputPanel({ row, level, juzTotal, index, count, onDone, bare }: { row: Row; level: string; juzTotal: number; index: number; count: number; onDone: () => void; bare?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const surahs = useQuery({ queryKey: ['surahs', level], queryFn: () => get(`/hafalan/surahs?level=${level}`) });
  const hist = useQuery({ queryKey: ['hist', row.id], queryFn: () => get(`/hafalan/students/${row.id}`) });
  const last = hist.data?.[0];
  const [surahId, setSurahId] = useState<number | null>(null);
  const [ayat, setAyat] = useState(1);
  const [confirm, setConfirm] = useState<string | null>(null);
  useEffect(() => { if (!surahs.data || hist.isLoading || surahId) return; const s = surahs.data.find((x: any) => last && x.name === last.surah); setSurahId((s ?? surahs.data[0]).id); setAyat(last?.ayat ?? 1); }, [surahs.data, last]); // eslint-disable-line
  const s = surahs.data?.find((x: any) => x.id === surahId);
  const before = s ? surahs.data.filter((x: any) => x.ord < s.ord).reduce((a: number, x: any) => a + x.ayat_count, 0) : 0;
  const total = before + ayat; const pct = Math.round((total / juzTotal) * 1000) / 10; const delta = total - (row.total ?? 0);
  const err = s && (ayat < 1 || ayat > s.ayat_count) ? `Ayat harus 1–${s.ayat_count}` : null;
  const save = useMutation({
    mutationFn: (confirmLower: boolean) => post('/hafalan/records', { studentId: row.id, surahId, ayat, confirmLower }),
    onSuccess: (d: any) => { toast(`${row.fullName.split(' ')[0]}: ${d.surah} ayat ${d.ayat} · ${fmt(d.percent)}%`); setConfirm(null); qc.invalidateQueries({ queryKey: ['roster'] }); qc.invalidateQueries({ queryKey: ['hafalan-classes'] }); qc.invalidateQueries({ queryKey: ['hist', row.id] }); onDone(); },
    onError: (e: any) => { if (e instanceof ApiError && e.status === 409) setConfirm(e.message); else toast(e.message, 'danger'); },
  });
  return (
    <div className="space-y-4">
      {!bare && <div><h2 className="h2 text-lg">Input hafalan</h2>{index > 0 && <div className="text-sm text-n-600">Santri ke-{index} dari {count}</div>}</div>}
      <div className="card p-4 flex items-center gap-3"><Avatar name={row.fullName} size={48} square /><div className="min-w-0"><div className="font-display font-extrabold truncate">{row.fullName}</div><div className="text-xs text-n-600">{last ? `Terakhir: ${last.surah} ayat ${last.ayat} · ${tgl(last.createdAt)}` : 'Belum ada catatan'}</div></div></div>
      <div className="card p-4 space-y-4">
        <div><label className="label" htmlFor={`sur-${row.id}`}>Surah</label>
          <select id={`sur-${row.id}`} className="input" value={surahId ?? ''} onChange={(e) => { setSurahId(Number(e.target.value)); setAyat(1); }}>{surahs.data?.map((x: any) => <option key={x.id} value={x.id}>{x.name} · {x.ayat_count} ayat</option>)}</select></div>
        <div><span className="label">Ayat terakhir</span>
          <div className="flex items-center gap-3"><button type="button" aria-label="Kurangi ayat" onClick={() => setAyat((a) => Math.max(1, a - 1))} className="w-12 h-12 rounded-2xl bg-n-50 text-brand-800 flex items-center justify-center"><Minus size={20} /></button>
            <input type="number" inputMode="numeric" aria-label="Ayat terakhir" value={ayat} min={1} max={s?.ayat_count} onChange={(e) => setAyat(Number(e.target.value))} className="flex-1 min-w-0 h-12 rounded-2xl border-2 border-brand-600 text-center num text-2xl" />
            <button type="button" aria-label="Tambah ayat" onClick={() => setAyat((a) => Math.min(s?.ayat_count ?? a + 1, a + 1))} className="w-12 h-12 rounded-2xl bg-brand-600 text-white shadow-brand flex items-center justify-center"><Plus size={20} /></button></div>
          {err && <p className="text-xs text-danger-fg mt-2">{err}</p>}</div>
        <div className={`flex items-center gap-4 p-3.5 rounded-2xl ${delta < 0 ? 'bg-butter-bg text-butter-fg' : 'bg-mint-bg text-mint-fg'}`}>
          <Ring size={56} stroke={9} label={`Capaian ${fmt(pct)}%`} segments={[{ value: pct, color: delta < 0 ? '#d9a52f' : '#1f7a4d' }, { value: 100 - pct, color: '#ffffff' }]} />
          <div><div className="num text-xl">{fmt(pct)}%</div><div className="text-xs">{total} dari {juzTotal} ayat · {delta >= 0 ? `+${delta}` : delta} ayat</div></div></div>
        <div className="flex gap-3"><button className="btn-soft flex-1" onClick={onDone}>Lewati</button><button className="btn-primary flex-[2]" disabled={!!err || save.isPending} onClick={() => save.mutate(false)}>{save.isPending ? 'Menyimpan…' : 'Simpan & berikutnya'}</button></div>
      </div>
      {hist.data?.length > 0 && <Card title={`Riwayat ${row.fullName.split(' ')[0]}`}>{hist.data.slice(0, 4).map((h: any) => <div key={h.id} className="flex items-center gap-3 py-2.5 border-b border-n-100 last:border-0 text-sm"><span className="w-16 text-n-600 text-xs">{tgl(h.weekStart)}</span><span className="flex-1 font-semibold">{h.surah} ayat {h.ayat}</span><b className="num">{fmt(h.percent)}%</b></div>)}</Card>}
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} title="Posisi lebih rendah">
        <Alert kind="warning">{confirm}</Alert>
        <div className="flex gap-3 mt-5"><button className="btn-soft flex-1" onClick={() => setConfirm(null)}>Periksa lagi</button><button className="btn-primary flex-1" onClick={() => save.mutate(true)}>Ya, simpan</button></div>
      </Dialog>
    </div>
  );
}
