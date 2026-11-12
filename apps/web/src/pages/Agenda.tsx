import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Lock, MapPin, Plus } from 'lucide-react';
import { can, get, patch, post, todayWIB } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Badge, Card, Chips, Dialog, Drawer, Empty, Field, KV, PageHeader, Toggle } from '../components/ui';
import { useToast } from '../components/Toast';

export const KATEGORI = [
  { value: 'KEGIATAN', label: 'Kegiatan', bg: 'bg-mint-bg', fg: 'text-mint-fg', dot: 'bg-mint-solid' },
  { value: 'LIBUR', label: 'Libur', bg: 'bg-rose-bg', fg: 'text-rose-fg', dot: 'bg-rose-solid' },
  { value: 'UJIAN', label: 'Ujian', bg: 'bg-butter-bg', fg: 'text-butter-fg', dot: 'bg-butter-solid' },
  { value: 'RAPAT', label: 'Rapat', bg: 'bg-lilac-bg', fg: 'text-lilac-fg', dot: 'bg-lilac-solid' },
  { value: 'LAINNYA', label: 'Lainnya', bg: 'bg-n-100', fg: 'text-n-700', dot: 'bg-n-500' },
] as const;
export const kategori = (v: string) => KATEGORI.find((k) => k.value === v) ?? KATEGORI[4];

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12
/** Geser tanggal 'YYYY-MM-DD' sebanyak n hari */
export const addDaysYmd = (s: string, n: number) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const tglPendek = (s: string) => { const [, m, d] = s.split('-').map(Number); return `${d} ${BULAN[m - 1].slice(0, 3)}`; };
/** "12 Nov" atau "12 Nov – 14 Nov" */
export const rentang = (a: { startDate: string; endDate: string }) => (a.startDate === a.endDate ? tglPendek(a.startDate) : `${tglPendek(a.startDate)} – ${tglPendek(a.endDate)}`);
export const jam = (a: { startTime?: string | null; endTime?: string | null }) => (a.startTime ? (a.endTime ? `${a.startTime}–${a.endTime}` : a.startTime).replace(/:/g, '.') : null);

type Form = { title: string; category: string; startDate: string; endDate: string; startTime: string; endTime: string; branchId: string; location: string; note: string };
const emptyForm = (date: string): Form => ({ title: '', category: 'KEGIATAN', startDate: date, endDate: '', startTime: '', endTime: '', branchId: '', location: '', note: '' });

/** Kalender bulan: hari yang punya agenda diberi titik warna kategori; klik hari = saring daftar */
function Bulan({ ym, items, day, onDay }: { ym: string; items: any[]; day: string; onDay: (d: string) => void }) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); const days = lastDay(y, m); const today = todayWIB();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-n-600 mb-1">{['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'].map((d) => <span key={d}>{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-1">{cells.map((d, i) => {
        if (d === null) return <span key={i} />;
        const date = `${ym}-${pad(d)}`;
        const on = items.filter((a) => !a.cancelledAt && a.startDate <= date && a.endDate >= date);
        const sel = day === date, isToday = date === today;
        return (
          <button key={i} type="button" onClick={() => onDay(sel ? '' : date)} aria-pressed={sel}
            aria-label={`${d} ${BULAN[m - 1]}${isToday ? ', hari ini' : ''}${on.length ? `, ${on.length} agenda: ${on.map((a) => a.title).join(', ')}` : ''}`}
            className={`h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[13px] font-semibold transition ${sel ? 'bg-brand-600 text-white' : isToday ? 'ring-2 ring-brand-600 text-brand-800' : 'text-n-800 hover:bg-n-50'}`}>
            {d}
            <span className="flex gap-0.5 h-1.5" aria-hidden>{on.slice(0, 3).map((a) => <span key={a.id} className={`w-1.5 h-1.5 rounded-full ${sel ? 'bg-white' : kategori(a.category).dot}`} />)}</span>
          </button>);
      })}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-4 text-xs text-n-700">{KATEGORI.map((k) => <span key={k.value} className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${k.dot}`} aria-hidden />{k.label}</span>)}</div>
    </div>);
}

export default function Agenda() {
  const { user } = useAuth(); const toast = useToast(); const qc = useQueryClient();
  const canInput = can(user, 'agenda.input'), canEdit = can(user, 'agenda.edit');
  const [ym, setYm] = useState(todayWIB().slice(0, 7));
  const [branchId, setBranchId] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [day, setDay] = useState('');
  const [y, m] = ym.split('-').map(Number);
  const from = `${ym}-01`, to = `${ym}-${pad(lastDay(y, m))}`;
  const list = useQuery({ queryKey: ['agenda', ym, branchId, showCancelled], queryFn: () => get(`/agenda?from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ''}${showCancelled ? '&includeCancelled=1' : ''}`) });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => get('/branches') });
  const prof = useQuery({ queryKey: ['profile'], queryFn: () => get('/auth/profile') });
  const scope = prof.data?.branches?.map((b: any) => b.name).join(', ');

  const [open, setOpen] = useState<any>(null); // null = tertutup, {} = baru, agenda = detail/ubah
  const [form, setForm] = useState<Form>(emptyForm(todayWIB()));
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [cancelOf, setCancelOf] = useState<any>(null); const [reason, setReason] = useState('');

  const shift = (n: number) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setYm(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`); setDay(''); };
  const openNew = () => { const t = todayWIB(); setForm(emptyForm(day || (t.startsWith(ym) ? t : from))); setErr(''); setOpen({}); };
  const openItem = (a: any) => {
    setForm({ title: a.title, category: a.category, startDate: a.startDate, endDate: a.endDate === a.startDate ? '' : a.endDate, startTime: a.startTime ?? '', endTime: a.endTime ?? '', branchId: a.branchId ? String(a.branchId) : '', location: a.location ?? '', note: a.note ?? '' });
    setErr(''); setOpen(a);
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ['agenda'] });
  const save = async () => {
    setErr(''); setBusy(true);
    const body = { title: form.title, category: form.category, startDate: form.startDate, endDate: form.endDate || undefined, startTime: form.startTime || null, endTime: form.endTime || null,
      branchId: form.branchId ? Number(form.branchId) : null, location: form.location || null, note: form.note || null };
    try {
      if (open?.id) { await patch(`/agenda/${open.id}`, body); toast('Agenda diperbarui'); } else { await post('/agenda', body); toast('Agenda ditambahkan'); }
      refresh(); setOpen(null);
    } catch (e: any) { setErr(e.details?.join(', ') ?? e.message); } finally { setBusy(false); }
  };
  const doCancel = async () => {
    setBusy(true);
    try { await post(`/agenda/${cancelOf.id}/cancel`, { reason }); toast('Agenda dibatalkan'); refresh(); setCancelOf(null); setOpen(null); }
    catch (e: any) { toast(e.details?.join(', ') ?? e.message, 'danger'); } finally { setBusy(false); }
  };

  const rows: any[] = (list.data?.rows ?? []).filter((a: any) => !day || (a.startDate <= day && a.endDate >= day));
  const editable = open && (open.id ? canEdit && !open.cancelledAt : canInput);
  const set = (k: keyof Form) => (e: any) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-5">
      <PageHeader title="Agenda" sub="Kegiatan, libur, ujian, dan rapat RTA per cabang"
        actions={<>
          {user?.branchIds && <span className="pill h-9 px-4 bg-white text-brand-800 shadow-chip"><Lock size={13} />{scope || 'Cabang Anda'}</span>}
          {!canInput && <span className="pill h-9 px-4 bg-white text-n-700 shadow-chip">Hanya baca</span>}
          {canInput && <button className="btn-primary hidden md:inline-flex" onClick={openNew}><Plus size={18} />Tambah agenda</button>}
        </>} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button className="icon-btn" onClick={() => shift(-1)} aria-label="Bulan sebelumnya"><ChevronLeft size={18} /></button>
          <h2 className="h2 min-w-[150px] text-center" aria-live="polite">{BULAN[m - 1]} {y}</h2>
          <button className="icon-btn" onClick={() => shift(1)} aria-label="Bulan berikutnya"><ChevronRight size={18} /></button>
        </div>
        {ym !== todayWIB().slice(0, 7) && <button className="btn-text" onClick={() => { setYm(todayWIB().slice(0, 7)); setDay(''); }}>Bulan ini</button>}
        <label className="flex items-center gap-2 text-sm text-n-700 ml-auto min-h-[44px]"><Toggle checked={showCancelled} onChange={setShowCancelled} label="Tampilkan agenda yang dibatalkan" />Tampilkan yang dibatalkan</label>
      </div>
      {!user?.branchIds && <Chips label="Filter cabang" value={branchId} onChange={(v) => { setBranchId(v); setDay(''); }}
        items={[{ value: '', label: 'Semua cabang' }, ...(branches.data ?? []).map((b: any) => ({ value: String(b.id), label: b.name }))]} />}

      <div className="grid lg:grid-cols-[340px_minmax(0,1fr)] gap-6 items-start">
        <Card className="lg:sticky lg:top-6"><Bulan ym={ym} items={list.data?.rows ?? []} day={day} onDay={setDay} /></Card>

        <section className="space-y-3 min-w-0" aria-label="Daftar agenda">
          {day && <div className="flex items-center justify-between gap-3 text-sm"><span className="text-n-700">Agenda tanggal <b>{tglPendek(day)}</b></span><button className="btn-text" onClick={() => setDay('')}>Tampilkan sebulan</button></div>}
          {!list.data ? <div className="text-sm text-n-600">Memuat…</div> : !rows.length ?
            <Card><Empty icon={CalendarDays} text={day ? 'Tidak ada agenda di tanggal ini.' : 'Belum ada agenda di bulan ini.'} action={canInput && <button className="btn-primary" onClick={openNew}><Plus size={18} />Tambah agenda</button>} /></Card> :
            rows.map((a) => { const k = kategori(a.category); const [, , dd] = a.startDate.split('-'); return (
              <button key={a.id} type="button" onClick={() => openItem(a)} className={`card w-full p-4 flex items-start gap-3 text-left hover:-translate-y-0.5 transition ${a.cancelledAt ? 'opacity-70' : ''}`}>
                <span className={`${k.bg} ${k.fg} w-14 shrink-0 rounded-2xl py-2 flex flex-col items-center`} aria-hidden>
                  <b className="font-display text-xl leading-none">{Number(dd)}</b><span className="text-[11px] mt-1">{BULAN[Number(a.startDate.slice(5, 7)) - 1].slice(0, 3)}</span>
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className={`pill ${k.bg} ${k.fg}`}>{k.label}</span>
                    <span className="pill bg-n-50 text-n-700">{a.branchName ?? 'Semua cabang'}</span>
                    {a.cancelledAt && <Badge status="DIBATALKAN" />}
                  </span>
                  <span className={`block font-bold ${a.cancelledAt ? 'line-through' : ''}`}>{a.title}</span>
                  <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-n-600 mt-1">
                    <span>{rentang(a)}</span>
                    {jam(a) && <span className="flex items-center gap-1"><Clock size={12} aria-hidden />{jam(a)}</span>}
                    {a.location && <span className="flex items-center gap-1 min-w-0"><MapPin size={12} aria-hidden /><span className="truncate">{a.location}</span></span>}
                  </span>
                  {a.cancelledAt && a.cancelReason && <span className="block text-xs text-danger-fg mt-1">Dibatalkan: {a.cancelReason}</span>}
                </span>
              </button>); })}
        </section>
      </div>

      {canInput && <button onClick={openNew} aria-label="Tambah agenda" className="md:hidden fixed right-5 bottom-[104px] z-30 w-14 h-14 rounded-full bg-brand-600 text-white shadow-brand flex items-center justify-center"><Plus size={24} /></button>}

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.id ? (editable ? 'Ubah agenda' : open.title) : 'Tambah agenda'}
        badge={open?.cancelledAt ? <Badge status="DIBATALKAN" /> : undefined}
        sub={open?.id && !editable ? `${rentang(open)}${jam(open) ? ` · ${jam(open)}` : ''}` : undefined}
        footer={editable && <div className="flex gap-3">
          {open?.id && <button className="btn-text text-danger-fg" onClick={() => { setReason(''); setCancelOf(open); }}>Batalkan agenda</button>}
          <button className="btn-primary flex-1" onClick={save} disabled={busy || form.title.trim().length < 3 || !form.startDate}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>}>
        {open && (editable ? <>
          {err && <Alert>{err}</Alert>}
          <Field label="Judul agenda"><input className="input" value={form.title} onChange={set('title')} maxLength={120} placeholder="Mis. Libur semester, Rapat wali santri" /></Field>
          <Field label="Kategori"><Chips label="Kategori agenda" value={form.category} onChange={(v) => setForm({ ...form, category: v })} items={KATEGORI.map((k) => ({ value: k.value, label: k.label }))} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tanggal mulai"><input className="input" type="date" value={form.startDate} onChange={set('startDate')} /></Field>
            <Field label="Tanggal selesai" hint="Kosongkan bila satu hari"><input className="input" type="date" value={form.endDate} min={form.startDate} onChange={set('endDate')} /></Field>
            <Field label="Jam mulai" hint="Opsional"><input className="input" type="time" value={form.startTime} onChange={set('startTime')} /></Field>
            <Field label="Jam selesai" hint="Opsional"><input className="input" type="time" value={form.endTime} onChange={set('endTime')} /></Field>
          </div>
          <Field label="Cabang" hint="Pilih 'Semua cabang' untuk agenda yang berlaku di seluruh RTA (mis. libur).">
            <select className="input" value={form.branchId} onChange={set('branchId')}><option value="">Semua cabang</option>{branches.data?.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </Field>
          <Field label="Lokasi" hint="Opsional"><input className="input" value={form.location} onChange={set('location')} maxLength={120} /></Field>
          <Field label="Catatan" hint="Opsional"><textarea className="input !h-24 py-3" value={form.note} onChange={set('note')} maxLength={500} /></Field>
        </> : <>
          <KV rows={[
            ['Kategori', kategori(open.category).label], ['Cabang', open.branchName ?? 'Semua cabang'], ['Tanggal', rentang(open)],
            ...(jam(open) ? [['Jam', jam(open)] as [string, string]] : []), ...(open.location ? [['Lokasi', open.location] as [string, string]] : []),
            ['Dibuat oleh', open.createdBy ?? '-'],
          ]} />
          {open.note && <Card title="Catatan"><p className="text-sm whitespace-pre-line">{open.note}</p></Card>}
          {open.cancelledAt && <Alert kind="warning">Agenda ini dibatalkan{open.cancelReason ? `: ${open.cancelReason}` : ''}.</Alert>}
        </>)}
      </Drawer>

      <Dialog open={!!cancelOf} onClose={() => setCancelOf(null)} title="Batalkan agenda">
        <div className="space-y-4">
          <p className="text-sm text-n-700">Agenda <b>{cancelOf?.title}</b> akan ditandai dibatalkan dan tetap tersimpan di riwayat.</p>
          <Field label="Alasan pembatalan"><textarea className="input !h-24 py-3" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Mis. Diundur ke bulan depan" /></Field>
          <div className="flex gap-3"><button className="btn-soft flex-1" onClick={() => setCancelOf(null)}>Kembali</button><button className="btn-danger flex-1" onClick={doCancel} disabled={busy || reason.trim().length < 3}>Batalkan agenda</button></div>
        </div>
      </Dialog>
    </div>
  );
}
