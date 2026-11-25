import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Check, ChevronLeft, ChevronRight, Info, Lock, MessageCircle } from 'lucide-react';
import { can, get, post, put, todayWIB } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { ExportMenu } from '../components/ExportMenu';
import { Alert, Avatar, Card, COLOR, Chips, Drawer, Empty, PageHeader, Ring, Segmented, StackBar } from '../components/ui';

type St = 'H' | 'I' | 'S' | 'A';
type Cell = St | 'BELUM' | 'CUTI' | null;
const ST: St[] = ['H', 'I', 'S', 'A'];
const NAMA: Record<string, string> = { H: 'Hadir', I: 'Izin', S: 'Sakit', A: 'Alpa', BELUM: 'Belum diisi', CUTI: 'Cuti', LIBUR: 'Libur', NANTI: 'Belum lewat' };
/** Warna sel status (token tema G). Izin & Alpa gelap agar teks putih terbaca. */
const CELL: Record<string, string> = {
  H: 'bg-mint-bg text-mint-fg', I: 'bg-info text-white', S: 'bg-butter-solid text-n-900', A: 'bg-danger text-white',
  CUTI: 'bg-n-100 text-n-600', BELUM: 'border-[1.5px] border-dashed border-warning bg-white text-warning-fg',
  LIBUR: 'hatch', NANTI: 'border-[1.5px] border-dashed border-n-300 bg-white', KOSONG: 'bg-n-50',
};
const TXT: Record<string, string> = { H: 'H', I: 'I', S: 'S', A: 'A', CUTI: 'C', BELUM: '?' };
const BTN_ON: Record<St, string> = { H: 'bg-mint-bg text-mint-fg ring-2 ring-inset ring-mint-solid', I: 'bg-info text-white', S: 'bg-butter-solid text-n-900', A: 'bg-danger text-white' };
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const HARI = ['Ahad', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMonths = (ym: string, n: number) => { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const tglPanjang = (ymd: string) => { const d = new Date(ymd + 'T00:00:00Z'); return `${HARI[d.getUTCDay()]}, ${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const bulanLabel = (ym: string) => `${BULAN[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const pctColor = (p: number | null, min: number) => (p == null ? 'text-n-600' : p < min ? 'text-danger-fg' : p < 90 ? 'text-warning-fg' : 'text-success-fg');
const lvl = (c: any) => String(c.level).replace('JUZ', 'Juz ');

export default function Absensi() {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const today = todayWIB();
  const canInput = can(user, 'absensi.input');
  const scoped = !!user?.branchIds;
  const classes = useQuery({ queryKey: ['absensi-classes'], queryFn: () => get('/absensi/classes') });
  const list: any[] = classes.data ?? [];
  const branches = useMemo(() => [...new Map(list.map((c) => [c.branchId, c.branchName])).entries()], [list]);
  const set = (k: Record<string, string | null>) => { const n = new URLSearchParams(sp); for (const [a, v] of Object.entries(k)) v == null ? n.delete(a) : n.set(a, v); setSp(n, { replace: true }); };
  const mode = (sp.get('mode') ?? (canInput ? 'isi' : 'rekap')) as 'isi' | 'rekap';
  const branch = sp.get('b') ?? 'ALL';
  const shown = list.filter((c) => branch === 'ALL' || String(c.branchId) === branch);
  const cls = shown.find((c) => String(c.id) === sp.get('c')) ?? shown[0];
  const date = sp.get('d') && sp.get('d')! <= today ? sp.get('d')! : today;
  const month = sp.get('m') ?? today.slice(0, 7);
  const oneBranch = branches.length === 1;
  // rekap dibaca juga di sini (cache yang sama dengan RekapView) untuk subjudul "jadwal … · n pertemuan"
  const recap = useQuery({ queryKey: ['absensi-recap', cls?.id, month], queryFn: () => get(`/absensi/recap?classId=${cls.id}&month=${month}`), enabled: mode === 'rekap' && !!cls });
  const r = recap.data;
  const sub = mode === 'isi' ? tglPanjang(date) : r ? `${bulanLabel(month)} · jadwal ${jadwal(r.rules.days)} · ${r.meetings} pertemuan s.d. ${sampai(r.days, today)}` : bulanLabel(month);
  const setMonth = (m: string) => set({ m: m === today.slice(0, 7) ? null : m });
  const setDate = (d: string) => set({ d: d === today ? null : d });
  const optLabel = (c: any) => `${lvl(c)}${mode === 'isi' && date === today && c.schoolDay && c.aktif > c.doneToday ? ' · belum diisi' : ''}`;
  const groups = branches.filter(([id]) => branch === 'ALL' || String(id) === branch);
  // pemilih kelas: dropdown (dikelompokkan per cabang bila lebih dari satu cabang)
  const picker = cls && (
    <select aria-label="Pilih kelas" value={String(cls.id)} onChange={(e) => set({ c: e.target.value })}
      className="input !h-11 !w-auto min-w-[170px] !rounded-full !border-0 bg-white shadow-soft font-bold text-brand-800">
      {groups.length > 1
        ? groups.map(([id, name]) => <optgroup key={id} label={name}>{shown.filter((c) => c.branchId === id).map((c) => <option key={c.id} value={c.id}>{name} · {optLabel(c)}</option>)}</optgroup>)
        : shown.map((c) => <option key={c.id} value={c.id}>{oneBranch ? '' : `${c.branchName} · `}{optLabel(c)}</option>)}
    </select>
  );
  const short = (ymd: string) => { const x = new Date(ymd + 'T00:00:00Z'); return `${HARI[x.getUTCDay()].slice(0, 3)}, ${x.getUTCDate()} ${BULAN[x.getUTCMonth()].slice(0, 3)} ${x.getUTCFullYear()}`; };

  return (
    <div className="space-y-5">
      <PageHeader title="Absensi" sub={sub}
        actions={<>
          {scoped && <span className="pill h-11 px-4 bg-white text-brand-800 shadow-soft"><Lock size={14} />Cabang {branches.map((b) => b[1]).join(', ')}</span>}
          {canInput && mode === 'rekap' && <button className="btn-primary !h-11 hidden md:inline-flex" onClick={() => set({ mode: 'isi', d: null })}>Isi absensi hari ini</button>}
          {mode === 'isi' && <button className="btn-secondary !h-11 hidden md:inline-flex" onClick={() => set({ mode: 'rekap' })}>Lihat rekap</button>}
          {picker}
          {mode === 'isi' && (
            <div className="inline-flex items-center gap-1 h-11 px-1 rounded-full bg-white shadow-soft">
              <button className="w-9 h-9 rounded-full flex items-center justify-center text-brand-800 hover:bg-n-50" aria-label="Hari sebelumnya" onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={16} /></button>
              <label className="relative px-1 min-w-[150px] text-center text-sm font-bold text-brand-800 cursor-pointer">
                {date === today ? `Hari ini · ${short(date).slice(0, -5)}` : short(date)}
                <input type="date" value={date} max={today} aria-label="Pilih tanggal" onChange={(e) => e.target.value && setDate(e.target.value)}
                  onClick={(e) => { try { (e.currentTarget as any).showPicker?.(); } catch { /* browser lama: biarkan */ } }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              </label>
              <button className="w-9 h-9 rounded-full flex items-center justify-center text-brand-800 hover:bg-n-50 disabled:opacity-40" aria-label="Hari berikutnya" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}><ChevronRight size={16} /></button>
            </div>
          )}
          {mode === 'isi' && date !== today && <button className="btn-text !h-11" onClick={() => setDate(today)}>Hari ini</button>}
          {mode === 'rekap' && (
            <div className="inline-flex items-center gap-1 h-11 px-1 rounded-full bg-white shadow-soft">
              <button className="w-9 h-9 rounded-full flex items-center justify-center text-brand-800 hover:bg-n-50" aria-label="Bulan sebelumnya" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft size={16} /></button>
              <span className="text-sm font-bold text-brand-800 px-1 min-w-[120px] text-center">{bulanLabel(month)}</span>
              <button className="w-9 h-9 rounded-full flex items-center justify-center text-brand-800 hover:bg-n-50 disabled:opacity-40" aria-label="Bulan berikutnya" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(addMonths(month, 1))}><ChevronRight size={16} /></button>
            </div>
          )}
          {mode === 'rekap' && cls && can(user, 'absensi.ekspor') && <ExportMenu path="/absensi/export" query={`classId=${cls.id}&month=${month}`} file={`absensi-${cls.branchName}-${lvl(cls)}-${month}`} />}
        </>} />

      {/* HP: pindah mode lewat segmented; desktop lewat tombol di header */}
      {canInput && <div className="md:hidden"><Segmented label="Mode absensi" value={mode} onChange={(v) => set({ mode: v })} items={[{ value: 'isi', label: 'Isi absensi' }, { value: 'rekap', label: 'Rekap' }]} /></div>}

      {!scoped && branches.length > 1 && (
        <Chips label="Filter cabang" value={branch} onChange={(v) => set({ b: v === 'ALL' ? null : v, c: null })}
          items={[{ value: 'ALL', label: 'Semua cabang' }, ...branches.map(([id, name]) => ({ value: String(id), label: name }))]} />
      )}

      {classes.isLoading ? <p className="text-sm text-n-600">Memuat…</p> : !cls ? <Card><Empty icon={CalendarCheck} text="Belum ada kelas di cabang Anda." /></Card> : mode === 'isi'
        ? <IsiView key={`${cls.id}-${date}`} cls={cls} date={date} />
        : <RekapView cls={cls} month={month} today={today} />}
    </div>
  );
}
const NAMA_HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Ahad'];
/** [1,2,3,4,5] → "Senin–Jumat"; tidak berurutan → "Senin, Rabu, Jumat" */
const jadwal = (days: number[]) => (days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1] + 1) ? `${NAMA_HARI[days[0] - 1]}–${NAMA_HARI[days[days.length - 1] - 1]}` : days.map((d) => NAMA_HARI[d - 1]).join(', '));
const sampai = (days: any[], today: string) => { const last = days[days.length - 1].date; const u = today < last ? today : last; return `${Number(u.slice(8))} ${BULAN[Number(u.slice(5, 7)) - 1].slice(0, 3)}`; };

// ================= Isi absensi harian =================
function IsiView({ cls, date }: { cls: any; date: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['absensi-day', cls.id, date], queryFn: () => get(`/absensi/day?classId=${cls.id}&date=${date}`) });
  const d = q.data;
  const [draft, setDraft] = useState<Record<number, { status: St; note: string }>>({});
  useEffect(() => {
    if (!d) return;
    const init: Record<number, { status: St; note: string }> = {};
    for (const r of d.rows) if (r.status === 'AKTIF') init[r.id] = { status: r.attendance ?? 'H', note: r.note ?? '' };
    setDraft(init);
  }, [d]);
  const save = useMutation({
    mutationFn: () => put('/absensi/day', { classId: cls.id, date, entries: Object.entries(draft).map(([id, v]) => ({ studentId: Number(id), status: v.status, ...(v.status === 'I' || v.status === 'S' ? { note: v.note } : {}) })) }),
    onSuccess: (r: any) => {
      toast(r.changed ? `Absensi ${lvl(cls)} tersimpan · ${r.summary.H} hadir` : 'Tidak ada perubahan');
      for (const k of ['absensi-day', 'absensi-classes', 'absensi-recap', 'absensi-student', 'absensi-perclass', 'dashboard']) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e: any) => toast(e.message, 'danger'),
  });
  if (!d) return <p className="text-sm text-n-600">Memuat…</p>;
  const editable = d.editable;
  const aktif = d.rows.filter((r: any) => r.status === 'AKTIF');
  const unsaved = aktif.filter((r: any) => !r.attendance).length;
  const dirty = aktif.some((r: any) => { const v = draft[r.id]; return v && (v.status !== r.attendance || (['I', 'S'].includes(v.status) && (v.note || '') !== (r.note || ''))); });
  const c = { H: 0, I: 0, S: 0, A: 0 } as Record<St, number>;
  for (const r of d.rows) { const v = r.status === 'AKTIF' && editable ? draft[r.id]?.status : r.attendance; if (v) c[v as St]++; }
  const setRow = (id: number, patch: Partial<{ status: St; note: string }>) => setDraft((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  const parts = (['I', 'S', 'A'] as St[]).filter((k) => c[k]).map((k) => `${c[k]} ${NAMA[k].toLowerCase()}`);

  return (
    <div className="space-y-5">
      {d.kind === 'LIBUR' ? (
        <Card><Empty icon={CalendarCheck} text={d.holiday ? `Libur: ${d.holiday}. Tidak ada absensi.` : 'Bukan hari belajar. Tidak ada absensi.'} /></Card>
      ) : <>
        <div className="grid grid-cols-4 gap-2 md:gap-3">
          {([['H', 'bg-mint-bg text-mint-fg'], ['I', 'bg-lilac-bg text-lilac-fg'], ['S', 'bg-butter-bg text-butter-fg'], ['A', 'bg-danger-bg text-danger-fg']] as [St, string][]).map(([k, cl]) => (
            <div key={k} className={`rounded-2xl px-3 py-2.5 md:p-4 ${cl}`}><div className="num text-xl md:text-2xl leading-none">{c[k]}</div><div className="text-xs font-semibold mt-1">{NAMA[k]}</div></div>
          ))}
        </div>

        {!editable && <Alert kind="info">Hanya baca. {d.lastSaved ? `Terakhir diisi ${d.lastSaved.by}.` : 'Absensi hari ini belum diisi.'}</Alert>}

        {aktif.length === 0 && d.rows.length === 0 ? <Card><Empty text="Belum ada santri aktif di kelas ini." /></Card> : (
          <Card pad={false} className="pb-2">
            <div className="flex flex-wrap items-center gap-2 px-4 md:px-5 pt-4 pb-3">
              <h2 className="h2 flex-1">{editable ? 'Ketuk H · I · S · A' : 'Daftar santri'}</h2>
              {editable && unsaved > 0 && <span className="pill bg-butter-bg text-butter-fg">{unsaved} belum disimpan</span>}
              {editable && <button className="btn-text !h-10" onClick={() => setDraft((s) => Object.fromEntries(Object.keys(s).map((id) => [id, { status: 'H' as St, note: '' }])))}><Check size={16} />Semua hadir</button>}
            </div>
            <ul className="grid md:grid-cols-2 gap-3 px-4 md:px-5 pb-3">
              {d.rows.map((r: any) => {
                const live = r.status === 'AKTIF' && editable;
                const v = live ? draft[r.id] : null;
                const cur: St | null = live ? v?.status ?? null : r.attendance;
                return (
                  <li key={r.id} className={`rounded-2xl bg-n-50 p-3 space-y-2.5 ${r.status !== 'AKTIF' ? 'opacity-70' : ''}`}>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={r.fullName} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm truncate">{r.fullName}</div>
                        <div className="text-xs text-n-600 truncate">{r.status === 'CUTI' ? 'Cuti · tidak diabsen' : r.status === 'PINDAH' ? 'Sudah pindah · hanya baca' : live && !r.attendance ? 'Belum disimpan' : r.nis}</div>
                      </div>
                      {r.status === 'CUTI' ? <span className="pill bg-n-100 text-n-700">Cuti</span> : live ? (
                        <div role="group" aria-label={`Kehadiran ${r.fullName}`} className="flex gap-1 shrink-0">
                          {ST.map((k) => (
                            <button key={k} type="button" aria-label={NAMA[k]} aria-pressed={cur === k} onClick={() => setRow(r.id, { status: k })}
                              className={`w-10 h-11 rounded-xl font-display font-extrabold text-sm transition ${cur === k ? BTN_ON[k] : 'bg-white text-n-600 hover:bg-n-100'}`}>{k}</button>
                          ))}
                        </div>
                      ) : cur ? <span className={`w-10 h-10 rounded-xl flex items-center justify-center font-display font-extrabold text-sm ${CELL[cur]}`} aria-label={NAMA[cur]}>{cur}</span> : <span className="text-xs text-n-600">—</span>}
                    </div>
                    {live && (cur === 'I' || cur === 'S') && (
                      <input className="input !h-11 bg-white" placeholder={cur === 'I' ? 'Keterangan (opsional), mis. acara keluarga' : 'Keterangan (opsional), mis. demam'}
                        maxLength={200} value={v?.note ?? ''} onChange={(e) => setRow(r.id, { note: e.target.value })} aria-label={`Keterangan ${r.fullName}`} />
                    )}
                    {!live && r.note && <p className="text-xs text-n-700 pl-[46px]">{r.note}</p>}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <p className="flex gap-2 items-start text-xs text-info-fg bg-info-bg rounded-2xl px-4 py-3"><Info size={16} className="shrink-0 mt-px" />
          Hanya santri Aktif yang diabsen. Sabtu–Ahad (sesuai Pengaturan) dan libur di Agenda otomatis dikunci.</p>

        {editable && aktif.length > 0 && (
          <div className="sticky bottom-[104px] md:bottom-4 z-20">
            <div className="card p-3 md:p-4 flex flex-wrap items-center gap-3 shadow-soft">
              <div className="flex-1 min-w-[160px] text-sm text-n-700">
                {dirty || unsaved ? <>Belum disimpan · <b>{c.H} hadir</b>{parts.length ? `, ${parts.join(', ')}` : ''}</> : <>Tersimpan{d.lastSaved ? ` · ${d.lastSaved.by}` : ''}</>}
              </div>
              <button className="btn-primary !h-12 flex-1 sm:flex-none" disabled={save.isPending || (!dirty && !unsaved)} onClick={() => save.mutate()}>
                {save.isPending ? 'Menyimpan…' : 'Simpan absensi'}
              </button>
            </div>
          </div>
        )}
      </>}
    </div>
  );
}

// ================= Rekap =================
function DayCell({ v, kind, today, size = 'md', label }: { v: Cell; kind: string; today?: boolean; size?: 'sm' | 'md'; label: string }) {
  const key = v ?? (kind === 'LIBUR' ? 'LIBUR' : kind === 'NANTI' ? 'NANTI' : 'KOSONG');
  const dim = size === 'sm' ? 'w-[26px] h-[26px] text-[10px] rounded-lg' : 'w-[30px] h-[30px] text-[11px] rounded-[9px]';
  return <span role="img" aria-label={label} className={`${dim} shrink-0 flex items-center justify-center font-display font-extrabold ${CELL[key]} ${today ? 'ring-2 ring-brand-600 ring-offset-2' : ''}`}>{v ? TXT[v] ?? '' : ''}</span>;
}
function Legend() {
  const items: [string, string][] = [['H', 'Hadir'], ['I', 'Izin'], ['S', 'Sakit'], ['A', 'Alpa'], ['CUTI', 'Cuti'], ['LIBUR', 'Libur (Sabtu, Ahad, Agenda)'], ['NANTI', 'Belum lewat'], ['BELUM', 'Belum diisi']];
  return <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-n-700">{items.map(([k, l]) => <span key={k} className="inline-flex items-center gap-1.5"><span className={`w-3.5 h-3.5 rounded ${CELL[k]}`} />{l}</span>)}</div>;
}

function RekapView({ cls, month, today }: { cls: any; month: string; today: string }) {
  const q = useQuery({ queryKey: ['absensi-recap', cls.id, month], queryFn: () => get(`/absensi/recap?classId=${cls.id}&month=${month}`) });
  const pc = useQuery({ queryKey: ['absensi-perclass', cls.branchId, month], queryFn: () => get(`/absensi/per-class?month=${month}&branchId=${cls.branchId}`) });
  const [view, setView] = useState<'pekan' | 'bulan'>('pekan');
  const [open, setOpen] = useState<number | null>(null);
  const r = q.data;
  // pekan (Senin–Ahad) di bulan ini; bawaan = pekan yang memuat hari ini (atau pekan pertama)
  const weeks = useMemo(() => {
    if (!r) return [] as number[][];
    const out: number[][] = []; let cur: number[] = [];
    r.days.forEach((d: any, i: number) => { if (d.dow === 'Sen' && cur.length) { out.push(cur); cur = []; } cur.push(i); });
    if (cur.length) out.push(cur);
    return out;
  }, [r]);
  const [wk, setWk] = useState<number | null>(null);
  useEffect(() => { setWk(null); }, [month, cls.id]);
  if (!r) return <p className="text-sm text-n-600">Memuat…</p>;
  const wIdx = wk ?? Math.max(0, weeks.findIndex((w) => w.some((i) => r.days[i].date === today)));
  const week = weeks[wIdx] ?? [];
  const min = r.rules.minPercent;
  const attention = r.rows.filter((x: any) => x.attention.length && x.status !== 'PINDAH');
  const label = (x: any, i: number) => `${x.fullName}, ${r.days[i].day} ${bulanLabel(month)}: ${NAMA[x.cells[i] ?? r.days[i].kind] ?? '-'}`;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-card p-4 md:p-5 bg-mint-bg text-mint-fg"><div className="num text-2xl md:text-3xl">{r.summary.percent == null ? '–' : `${r.summary.percent}%`}</div><div className="text-xs md:text-sm font-semibold mt-1">Rata-rata kehadiran</div></div>
        <div className="rounded-card p-4 md:p-5 bg-lilac-bg text-lilac-fg"><div className="num text-2xl md:text-3xl">{r.summary.I}</div><div className="text-xs md:text-sm font-semibold mt-1">Izin</div></div>
        <div className="rounded-card p-4 md:p-5 bg-butter-bg text-butter-fg"><div className="num text-2xl md:text-3xl">{r.summary.S}</div><div className="text-xs md:text-sm font-semibold mt-1">Sakit</div></div>
        <div className="rounded-card p-4 md:p-5 bg-danger-bg text-danger-fg"><div className="num text-2xl md:text-3xl">{r.summary.A}</div><div className="text-xs md:text-sm font-semibold mt-1">Alpa{r.summary.attention ? ` · ${r.summary.attention} perlu perhatian` : ''}</div></div>
      </div>
      {r.summary.BELUM > 0 && <Alert kind="warning">{r.summary.BELUM} sel hari belajar belum diisi. Tanggal yang belum diisi tidak dihitung dalam persentase.</Alert>}

      <div className="hidden md:flex justify-end"><Legend /></div>

      {r.rows.length === 0 ? <Card><Empty text="Belum ada santri di kelas ini." /></Card> : <>
        {/* HP: per pekan / per bulan */}
        <div className="md:hidden space-y-4">
          <Segmented label="Periode" value={view} onChange={setView} items={[{ value: 'pekan', label: 'Per pekan' }, { value: 'bulan', label: 'Per bulan' }]} />
          {view === 'pekan' ? <>
            <div className="flex items-center gap-3">
              <button className="icon-btn disabled:opacity-40" aria-label="Pekan sebelumnya" disabled={wIdx <= 0} onClick={() => setWk(wIdx - 1)}><ChevronLeft size={18} /></button>
              <div className="flex-1 text-center font-display font-black">{week.length ? `${r.days[week[0]].day} – ${r.days[week[week.length - 1]].day} ${BULAN[Number(month.slice(5, 7)) - 1].slice(0, 3)}` : ''}</div>
              <button className="icon-btn disabled:opacity-40" aria-label="Pekan berikutnya" disabled={wIdx >= weeks.length - 1} onClick={() => setWk(wIdx + 1)}><ChevronRight size={18} /></button>
            </div>
            <div className="card p-3 space-y-2 overflow-x-auto">
              <div className="flex items-end gap-[3px]">
                <div className="w-[60px] shrink-0" />
                {week.map((i) => <div key={i} className={`w-[30px] shrink-0 text-center leading-tight ${r.days[i].date === today ? 'text-brand-600' : 'text-n-600'}`}><div className="text-[10px] font-semibold">{r.days[i].dow}</div><div className="text-[13px] font-extrabold">{r.days[i].day}</div></div>)}
                <div className="flex-1 min-w-[40px] text-right text-[10px] font-bold text-n-600">Bulan</div>
              </div>
              {r.rows.map((x: any) => (
                <button key={x.id} type="button" onClick={() => setOpen(x.id)} className="w-full flex items-center gap-[3px] text-left">
                  <span className="w-[60px] shrink-0 text-[13px] font-bold truncate">{x.nickname || x.fullName.split(' ')[0]}</span>
                  {week.map((i) => <DayCell key={i} v={x.cells[i]} kind={r.days[i].kind} today={r.days[i].date === today} label={label(x, i)} />)}
                  <span className={`flex-1 min-w-[40px] text-right num text-[13px] ${pctColor(x.percent, min)}`}>{x.percent == null ? '–' : `${x.percent}%`}</span>
                </button>
              ))}
            </div>
          </> : (
            <ul className="space-y-3">
              {r.rows.map((x: any) => (
                <li key={x.id}>
                  <button type="button" onClick={() => setOpen(x.id)} className="w-full card p-4 text-left space-y-2.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={x.fullName} />
                      <div className="flex-1 min-w-0"><div className="font-bold text-sm truncate">{x.fullName}</div><div className="text-xs text-n-600 truncate">{x.counts.H} hadir{(['I', 'S', 'A'] as St[]).filter((k) => x.counts[k]).map((k) => ` · ${NAMA[k].toLowerCase()} ${x.counts[k]}`).join('')}</div></div>
                      <span className={`num text-lg ${pctColor(x.percent, min)}`}>{x.percent == null ? '–' : `${x.percent}%`}</span>
                    </div>
                    <StackBar h={8} label={`${x.fullName}: hadir ${x.counts.H}, izin ${x.counts.I}, sakit ${x.counts.S}, alpa ${x.counts.A}`}
                      parts={[{ value: x.counts.H, color: COLOR.lunas }, { value: x.counts.I, color: COLOR.menunggu }, { value: x.counts.S, color: COLOR.belum }, { value: x.counts.A, color: COLOR.tunggakan }]} />
                    {(x.attention.length > 0 || x.status !== 'AKTIF') && <div className="flex flex-wrap gap-2">
                      {x.attention.map((a: string) => <span key={a} className="pill bg-danger-bg text-danger-fg">{a}</span>)}
                      {x.status === 'CUTI' && <span className="pill bg-n-100 text-n-700">Cuti</span>}
                      {x.status === 'PINDAH' && <span className="pill bg-n-100 text-n-700">Sudah pindah</span>}
                    </div>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Desktop: tabel satu bulan */}
        <Card pad={false} className="hidden md:block py-5">
          <div className="overflow-x-auto px-5">
            <table className="border-separate border-spacing-y-1.5">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white text-left text-[13px] font-semibold text-n-600 pr-4 min-w-[200px]">Santri</th>
                  {r.days.map((d: any, i: number) => (
                    <th key={d.date} className={`p-0 font-normal ${d.dow === 'Sen' && i > 0 ? 'pl-2.5' : 'pl-[3px]'} ${d.date === today ? 'text-brand-600' : 'text-n-600'}`} title={d.holiday ?? undefined}>
                      <div className="w-[26px] text-center leading-tight"><div className="text-[10px] font-semibold">{d.dow}</div><div className="text-[12px] font-extrabold">{d.day}</div></div>
                    </th>
                  ))}
                  <th className="sticky right-0 z-10 bg-white text-right text-[13px] font-semibold text-n-600 pl-4">Hadir</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((x: any) => (
                  <tr key={x.id}>
                    <td className="sticky left-0 z-10 bg-white pr-4">
                      <button type="button" onClick={() => setOpen(x.id)} className="flex items-center gap-2.5 text-left hover:text-brand-700">
                        <Avatar name={x.fullName} size={32} /><span className="text-sm font-bold whitespace-nowrap">{x.fullName}</span>
                      </button>
                    </td>
                    {r.days.map((d: any, i: number) => <td key={d.date} className={`p-0 ${d.dow === 'Sen' && i > 0 ? 'pl-2.5' : 'pl-[3px]'}`}><DayCell size="sm" v={x.cells[i]} kind={d.kind} today={d.date === today} label={label(x, i)} /></td>)}
                    <td className="sticky right-0 z-10 bg-white pl-4 text-right whitespace-nowrap">
                      <div className={`num text-[15px] ${pctColor(x.percent, min)}`}>{x.percent == null ? '–' : `${x.percent}%`}</div>
                      <div className="text-[11px] text-n-600">{x.status === 'CUTI' ? 'Cuti' : x.status === 'PINDAH' ? 'Pindah' : (['I', 'S', 'A'] as St[]).filter((k) => x.counts[k]).map((k) => `${k}${x.counts[k]}`).join(' ') || '—'}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 mt-2 text-xs text-n-600">{r.rows.length} santri · diurutkan dari kehadiran terendah · klik nama untuk kalender & kabari wali</p>
        </Card>
        <div className="md:hidden"><Legend /></div>
      </>}

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        <Card title="Per kelas">
          {!pc.data ? <p className="text-sm text-n-600">Memuat…</p> : <div className="space-y-3">{pc.data.map((c: any, i: number) => (
            <div key={c.classId} className="flex items-center gap-3 text-sm">
              <span className="w-36 shrink-0 truncate">{c.name}</span>
              <div className="flex-1 h-2.5 rounded-full bg-n-100" role="img" aria-label={`${c.name}: ${c.percent ?? 0}% kehadiran`}><div className="h-2.5 rounded-full" style={{ width: `${c.percent ?? 0}%`, background: i % 2 ? COLOR.menunggu : COLOR.brand }} /></div>
              <b className="w-10 text-right num">{c.percent == null ? '–' : `${c.percent}%`}</b>
            </div>))}</div>}
        </Card>
        <Card title="Perlu perhatian">
          {attention.length === 0 ? <p className="text-sm text-n-600">Tidak ada santri yang perlu perhatian bulan ini.</p> : <ul className="space-y-1">{attention.slice(0, 5).map((x: any) => (
            <li key={x.id}><button type="button" onClick={() => setOpen(x.id)} className="w-full flex items-center gap-3 py-1.5 text-left">
              <Avatar name={x.fullName} size={32} /><div className="flex-1 min-w-0"><div className="text-sm font-bold truncate">{x.fullName}</div><div className="text-xs text-danger-fg font-semibold truncate">{x.attention.join(' · ')}</div></div>
              <span className={`num ${pctColor(x.percent, min)}`}>{x.percent == null ? '–' : `${x.percent}%`}</span></button></li>))}</ul>}
        </Card>
        <div className="rounded-card p-4 md:p-5 bg-lilac-bg text-lilac-fg text-sm leading-relaxed">
          <b>Cara hitung.</b> Kehadiran = hadir ÷ pertemuan yang sudah diisi. Hari libur, masa cuti, dan tanggal yang belum diisi tidak dihitung.
          Perlu perhatian = alpa {r.rules.alpaStreak}× berturut-turut atau kehadiran di bawah {min}% (diatur di Pengaturan).
        </div>
      </div>

      <SantriDrawer id={open} month={month} today={today} onClose={() => setOpen(null)} />
    </div>
  );
}

// ================= Detail santri =================
function SantriDrawer({ id, month, today, onClose }: { id: number | null; month: string; today: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['absensi-student', id, month], queryFn: () => get(`/absensi/students/${id}?month=${month}`), enabled: !!id });
  const d = q.data;
  const blanks = d ? d.days[0].dow - 1 : 0;
  const notes = d ? d.days.filter((x: any) => x.note) : [];
  return (
    <Drawer open={!!id} onClose={onClose} title={d?.student.fullName ?? 'Memuat…'} sub={d && `${d.student.className} · ${d.label}`}
      footer={d?.wa && (
        <a className="btn w-full !h-12 bg-success text-white hover:opacity-90" href={d.wa.waUrl} target="_blank" rel="noreferrer" onClick={() => { post(`/absensi/students/${d.student.id}/wa`).catch(() => {}); }}>
          <MessageCircle size={18} />Kabari wali via WhatsApp
        </a>
      )}>
      {!d ? <p className="text-sm text-n-600">Memuat…</p> : <>
        <div className="card p-4 flex items-center gap-4">
          <Ring size={88} stroke={12} label={`Kehadiran ${d.percent ?? 0}%: hadir ${d.counts.H}, izin ${d.counts.I}, sakit ${d.counts.S}, alpa ${d.counts.A}`} center={d.percent == null ? '–' : `${d.percent}%`}
            segments={d.meetings ? [{ value: d.counts.H, color: COLOR.lunas }, { value: d.counts.I, color: COLOR.menunggu }, { value: d.counts.S, color: COLOR.belum }, { value: d.counts.A, color: COLOR.tunggakan }] : [{ value: 1, color: COLOR.netral }]} />
          <div className="space-y-1 min-w-0">
            <div className="text-sm"><b>{d.counts.H} hadir</b> dari {d.meetings} pertemuan</div>
            {d.alpaStreak && <div className="text-sm font-bold text-danger-fg">{d.alpaStreak.n} alpa berturut-turut · {Number(d.alpaStreak.from.slice(8))}–{Number(d.alpaStreak.to.slice(8))} {BULAN[Number(month.slice(5, 7)) - 1].slice(0, 3)}</div>}
            <div className="text-xs text-n-600">Izin {d.counts.I} · Sakit {d.counts.S} · Alpa {d.counts.A}{d.counts.BELUM ? ` · ${d.counts.BELUM} belum diisi` : ''}</div>
          </div>
        </div>
        <div className="card p-3">
          <div className="grid grid-cols-7 gap-1.5">
            {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Ahd'].map((h) => <div key={h} className="text-center text-[11px] font-bold text-n-600 pb-1">{h}</div>)}
            {Array.from({ length: blanks }).map((_, i) => <div key={`b${i}`} />)}
            {d.days.map((x: any) => {
              const key = x.v ?? (x.kind === 'LIBUR' ? 'LIBUR' : x.kind === 'NANTI' ? 'NANTI' : 'KOSONG');
              return <div key={x.date} role="img" aria-label={`${x.day}: ${x.holiday ?? NAMA[x.v ?? x.kind] ?? '-'}`} title={x.holiday ?? x.note ?? undefined}
                className={`h-10 rounded-xl flex items-center justify-center font-display font-extrabold text-[13px] ${CELL[key]} ${key === 'LIBUR' || key === 'NANTI' || key === 'KOSONG' ? 'text-n-600' : ''} ${x.date === today ? 'ring-2 ring-brand-600 ring-offset-2' : ''}`}>{x.day}</div>;
            })}
          </div>
        </div>
        <Legend />
        {notes.length > 0 && <Card title="Keterangan">{notes.map((x: any) => <div key={x.date} className="flex gap-3 py-2 border-b border-n-100 last:border-0 text-sm"><span className="w-14 text-n-600 text-xs pt-0.5">{x.day} {BULAN[Number(month.slice(5, 7)) - 1].slice(0, 3)}</span><span className={`pill ${CELL[x.v]}`}>{NAMA[x.v]}</span><span className="flex-1">{x.note}</span></div>)}</Card>}
        {d.wa && <div><div className="label">Pratinjau pesan WhatsApp</div><div className="rounded-2xl bg-mint-bg p-4 text-sm whitespace-pre-wrap break-words">{d.wa.message}</div></div>}
      </>}
    </Drawer>
  );
}
