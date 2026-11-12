import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CheckCircle2, Clock, Lock, MessageCircle, UserPlus } from 'lucide-react';
import { can, get, post, rupiah, tgl, todayWIB } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { Alert, Avatar, Badge, Card, Chips, COLOR, Drawer, Empty, Field, PageHeader, SearchBox, Segmented, Stat, StackBar, Toggle } from '../components/ui';
import { ExportMenu } from '../components/ExportMenu';
import { UploadDrawer } from './Bayar';

type Inst = { id: number; no: number; label: string; amount: number; dueDate: string | null; status: string; paidAt: string | null; method: string | null };
type Row = {
  studentId: number; fullName: string; nickname: string | null; branchName: string; className: string; familyId: number; familyName: string;
  scheme: 'BELUM_DIATUR' | 'LUNAS' | 'CICIL'; count: number; fee: number; paid: number; pending: number; sisa: number; paidCount: number;
  status: string; next: { id: number; no: number; amount: number; dueDate: string | null; status: string } | null; installments: Inst[];
};
type Data = { yearStart: string; minDp: number; maxInstallments: number; rows: Row[]; summary: Record<string, number> };
type Pay = { familyId: number; familyName: string; preselect: number[] };

const SEG: Record<string, string> = { LUNAS: COLOR.lunas, MENUNGGU: COLOR.menunggu, TUNGGAKAN: COLOR.tunggakan };
const SKEMA: Record<string, [string, string]> = { BELUM_DIATUR: ['bg-n-100 text-n-700', 'Belum diatur'], LUNAS: ['bg-mint-bg text-mint-fg', 'Lunas langsung'], CICIL: ['bg-lilac-bg text-lilac-fg', 'Cicil'] };
const skema = (r: Row) => { const [c, l] = SKEMA[r.scheme]; return <span className={`pill ${c}`}>{r.scheme === 'CICIL' ? `Cicil ${r.count}×` : l}</span>; };
const instName = (i: { no: number }, n: number) => (n === 1 ? 'Pelunasan' : i.no === 1 ? 'DP' : `Cicilan ${i.no}`);
const daysLate = (d: string) => Math.round((Date.parse(todayWIB()) - Date.parse(d)) / 86_400_000);
/** 'YYYY-MM-DD' + n bulan, tanggal tetap (akhir bulan bila tidak ada) — sama dengan server */
const addMonthsKeepDay = (ymd: string, n: number) => { const [y, m, d] = ymd.split('-').map(Number); const last = new Date(Date.UTC(y, m + n, 0)).getUTCDate(); return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10); };
/** Pembagian sama dengan server: DP + sisa dibagi rata (kelipatan Rp1.000), cicilan terakhir menyerap selisih */
const split = (fee: number, n: number, dp: number) => { const rest = fee - dp, each = Math.floor(rest / (n - 1) / 1000) * 1000; return [dp, ...Array(Math.max(0, n - 2)).fill(each), rest - each * (n - 2)]; };

/** Bilah per cicilan: hijau lunas, ungu menunggu verifikasi, merah terlambat */
function Segs({ r, h = 8 }: { r: Row; h?: number }) {
  return <div role="img" aria-label={`${r.paidCount} dari ${r.installments.length} pembayaran lunas`} className="flex gap-1 w-full">{r.installments.map((i) => <span key={i.id} className="flex-1 rounded-full" style={{ height: h, background: SEG[i.status] ?? COLOR.netral }} />)}</div>;
}
function progressText(r: Row) {
  if (r.status === 'LUNAS') return 'Lunas';
  if (r.status === 'MENUNGGU' && !r.paid) return 'Diperiksa';
  if (!r.paid) return r.scheme === 'CICIL' ? 'Belum DP' : r.scheme === 'LUNAS' ? 'Belum bayar' : 'Belum ada';
  return `${r.paidCount}/${r.installments.length}${r.status === 'TERLAMBAT' ? ' · telat' : r.paidCount === 1 && r.scheme === 'CICIL' ? ' · DP' : ''}`;
}
function dueText(r: Row) {
  if (!r.next) return '—';
  if (!r.next.dueDate) return r.next.status === 'TUNGGAKAN' ? <span className="text-danger-fg font-semibold">Lewat bulan bergabung</span> : r.scheme === 'BELUM_DIATUR' ? 'Atur skema dulu' : '—';
  const late = r.next.status === 'TUNGGAKAN';
  return <span className={late ? 'text-danger-fg font-semibold' : ''}>{tgl(r.next.dueDate)}{late ? ` · lewat ${daysLate(r.next.dueDate)} hari` : ` · ${rupiah(r.next.amount)}`}</span>;
}

export default function Pendaftaran() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['registrations'], queryFn: () => get<Data>('/registrations') });
  const [filter, setFilter] = useState('SEMUA'); const [term, setTerm] = useState('');
  const [selId, setSelId] = useState<number | null>(null); const [planId, setPlanId] = useState<number | null>(null);
  const [pay, setPay] = useState<Pay | null>(null);
  const d = q.data; const rows = d?.rows ?? [];
  const sel = rows.find((r) => r.studentId === selId) ?? null; const planRow = rows.find((r) => r.studentId === planId) ?? null;
  const n = (s: string) => rows.filter((r) => (s === 'CICILAN' ? r.scheme === 'CICIL' && r.status !== 'LUNAS' : r.status === s)).length;
  const shown = rows.filter((r) => (filter === 'SEMUA' || (filter === 'CICILAN' ? r.scheme === 'CICIL' && r.status !== 'LUNAS' : r.status === filter))
    && (!term || `${r.fullName} ${r.familyName}`.toLowerCase().includes(term.toLowerCase())));
  const yr = d ? Number(d.yearStart.slice(0, 4)) : 0;
  const s = d?.summary ?? {};
  const readOnly = !can(user, 'bayar.input') && !can(user, 'pendaftaran.edit');
  return (
    <div className="space-y-5">
      <PageHeader title="Pendaftaran" sub={<>Tagihan pendaftaran santri baru{d ? ` · tahun pembelajaran ${yr}/${yr + 1}` : ''}{user?.branchIds && <span className="pill bg-n-100 text-n-700 ml-2"><Lock size={12} />Cabang Anda</span>}{readOnly && <span className="pill bg-n-100 text-n-700 ml-2">Hanya baca</span>}</>}
        actions={<>{can(user, 'pendaftaran.ekspor') && <ExportMenu path="/registrations/export" file={`pendaftaran-${d ? `${yr}-${yr + 1}` : 'tahun-ini'}`} />}{can(user, 'santri.input') && <Link to="/santri/baru" className="btn-primary"><UserPlus size={16} />Santri baru</Link>}</>} />
      {d && <Alert kind="info">{d.maxInstallments > 1 ? <><b>Lunas langsung</b> atau <b>cicil maksimal {d.maxInstallments} kali</b> (termasuk DP) · <b>DP minimal {rupiah(d.minDp)}</b> · sisa dibagi rata, jatuh tempo per bulan. Cicilan muncul di menu Bayar pada bulan jatuh temponya.</> : 'Biaya pendaftaran dibayar lunas (cicilan dimatikan di Pengaturan).'}</Alert>}
      {q.isLoading ? <p className="text-sm text-n-600">Memuat…</p> : !d ? null : <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat filled tone={0} icon={UserPlus} value={s.total} label="Pendaftar baru" onClick={() => setFilter('SEMUA')} active={filter === 'SEMUA'} />
          <Stat filled tone={3} icon={CheckCircle2} value={s.lunas} label="Lunas" onClick={() => setFilter('LUNAS')} active={filter === 'LUNAS'} />
          <Stat filled tone={2} icon={Clock} value={s.cicilan} label="Cicilan berjalan" onClick={() => setFilter('CICILAN')} active={filter === 'CICILAN'} />
          <Stat filled tone={1} icon={AlertTriangle} value={s.belumBayar} label="Belum bayar" onClick={() => setFilter('BELUM_BAYAR')} active={filter === 'BELUM_BAYAR'} />
        </div>
        <Card>
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="shrink-0"><div className="text-xs text-n-600">Terkumpul (terverifikasi)</div><div className="flex items-baseline gap-2 flex-wrap"><span className="num text-2xl md:text-[28px]">{rupiah(s.terkumpul)}</span><span className="text-xs text-n-600">dari {rupiah(s.target)}</span></div></div>
            <div className="flex-1 min-w-0 space-y-2">
              <StackBar h={12} label={`Terkumpul ${rupiah(s.terkumpul)}, menunggu verifikasi ${rupiah(s.diperiksa)}, belum dibayar ${rupiah(s.target - s.terkumpul - s.diperiksa)} dari ${rupiah(s.target)}`}
                parts={[{ value: s.terkumpul, color: COLOR.lunas }, { value: s.diperiksa, color: COLOR.menunggu }, { value: Math.max(0, s.target - s.terkumpul - s.diperiksa), color: COLOR.belum }]} />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-n-700">{[['Terkumpul', COLOR.lunas], ['Menunggu verifikasi', COLOR.menunggu], ['Belum dibayar', COLOR.belum]].map(([l, c]) => <span key={l} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c }} />{l}</span>)}</div>
            </div>
          </div>
        </Card>
        <Card pad={false}>
          <div className="p-4 md:p-5 space-y-3">
            <SearchBox value={term} onChange={setTerm} placeholder="Cari santri atau wali" className="md:w-80" />
            <Chips label="Filter status" value={filter} onChange={setFilter} items={[
              { value: 'SEMUA', label: 'Semua', n: rows.length }, { value: 'LUNAS', label: 'Lunas', n: n('LUNAS') }, { value: 'CICILAN', label: 'Cicilan', n: n('CICILAN') },
              { value: 'TERLAMBAT', label: 'Terlambat', n: n('TERLAMBAT') }, { value: 'BELUM_BAYAR', label: 'Belum bayar', n: n('BELUM_BAYAR') }, { value: 'MENUNGGU', label: 'Menunggu verifikasi', n: n('MENUNGGU') }]} />
          </div>
          {!shown.length ? <div className="px-4 pb-5"><Empty icon={UserPlus} text={rows.length ? 'Tidak ada santri dengan filter ini.' : 'Belum ada santri baru di tahun pembelajaran ini.'} /></div> : <>
            <div className="hidden md:block scroll-x"><table className="w-full">
              <thead><tr><th className="th pl-5">Santri</th><th className="th">Skema</th><th className="th">Progres</th><th className="th text-right">Sisa</th><th className="th">Jatuh tempo</th><th className="th pr-5">Status</th></tr></thead>
              <tbody>{shown.map((r) => (
                <tr key={r.studentId} onClick={() => setSelId(r.studentId)} className={`cursor-pointer hover:bg-n-50 ${selId === r.studentId ? 'bg-brand-50' : ''}`}>
                  <td className="td pl-5"><button className="flex items-center gap-3 text-left" onClick={() => setSelId(r.studentId)}><Avatar name={r.fullName} size={36} /><span><span className="block font-semibold">{r.fullName}</span><span className="text-xs text-n-600">{r.branchName} · {rupiah(r.fee)}</span></span></button></td>
                  <td className="td">{skema(r)}</td>
                  <td className="td"><div className="flex items-center gap-3 w-44"><div className="w-24"><Segs r={r} /></div><span className="text-xs text-n-700 whitespace-nowrap">{progressText(r)}</span></div></td>
                  <td className={`td text-right num ${r.sisa ? 'text-danger-fg' : 'text-n-500'}`}>{rupiah(r.sisa)}</td>
                  <td className="td text-sm">{dueText(r)}</td>
                  <td className="td pr-5"><Badge status={r.status} /></td>
                </tr>))}</tbody></table></div>
            <div className="md:hidden px-4 pb-4 space-y-3">{shown.map((r) => (
              <button key={r.studentId} onClick={() => setSelId(r.studentId)} className="card w-full p-4 text-left space-y-3">
                <div className="flex items-center gap-3"><Avatar name={r.fullName} /><div className="flex-1 min-w-0"><div className="font-semibold break-words">{r.fullName}</div><div className="text-xs text-n-600">{r.scheme === 'CICIL' ? `Cicil ${r.count}×` : SKEMA[r.scheme][1]} · {r.branchName}</div></div><Badge status={r.status} label={r.scheme === 'CICIL' && r.status === 'CICILAN' ? `Cicilan ${r.paidCount}/${r.count}` : undefined} /></div>
                <div className="flex items-center gap-3"><div className="flex-1"><Segs r={r} /></div><span className={`num text-sm ${r.sisa ? 'text-danger-fg' : 'text-n-500'}`}>{rupiah(r.sisa)}</span></div>
              </button>))}</div>
          </>}
        </Card>
      </>}
      {sel && <Detail r={sel} d={d!} onClose={() => setSelId(null)} onPlan={() => { setSelId(null); setPlanId(sel.studentId); }} onPay={(p) => { setSelId(null); setPay(p); }} />}
      {planRow && <PlanDrawer r={planRow} d={d!} onClose={() => setPlanId(null)} onPay={(p) => { setPlanId(null); setPay(p); }} />}
      {pay && <UploadDrawer familyId={pay.familyId} familyName={pay.familyName} preselect={pay.preselect} onClose={() => setPay(null)} />}
    </div>
  );
}

function Detail({ r, d, onClose, onPlan, onPay }: { r: Row; d: Data; onClose: () => void; onPlan: () => void; onPay: (p: Pay) => void }) {
  const { user } = useAuth(); const toast = useToast();
  const unpaid = r.installments.filter((i) => !['LUNAS', 'MENUNGGU'].includes(i.status));
  const canPay = can(user, 'bayar.input'), canPlan = can(user, 'pendaftaran.edit') && !r.paid && !r.pending;
  const n = r.installments.length;
  const wa = async () => {
    const w = window.open('', '_blank'); // dibuka saat diklik agar tidak diblokir browser
    try { const x = await post(`/bayar/families/${r.familyId}/link`); if (w) w.location.href = x.waUrl; else window.location.href = x.waUrl; }
    catch (e: any) { w?.close(); toast(e.message, 'danger'); }
  };
  const payNext = () => r.next && onPay({ familyId: r.familyId, familyName: r.familyName, preselect: [r.next.id] });
  const payAll = () => onPay({ familyId: r.familyId, familyName: r.familyName, preselect: unpaid.map((i) => i.id) });
  return (
    <Drawer open onClose={onClose} title={r.fullName} sub={`${r.className} · Kel. ${r.familyName}`} badge={<Badge status={r.status} />}
      footer={(canPay || canPlan) && r.status !== 'LUNAS' ? <div className="space-y-2">
        {canPay && r.next && <button className="btn-primary w-full" onClick={payNext}>Catat {n === 1 ? 'pembayaran' : instName(r.next, n)} · {rupiah(r.next.amount)}</button>}
        <div className="flex flex-wrap gap-2">
          {canPay && unpaid.length > 0 && <button className="btn-wa flex-1 min-w-[136px]" onClick={wa}><MessageCircle size={15} />Pengingat WA</button>}
          {canPay && unpaid.length > 1 && <button className="btn-secondary flex-1 min-w-[136px]" onClick={payAll}>Lunasi sisa</button>}
          {canPlan && <button className="btn-soft flex-1 min-w-[136px]" onClick={onPlan}>Atur skema</button>}
        </div></div> : undefined}>
      <div className="card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3"><div><div className="text-xs text-n-600">Biaya pendaftaran · {r.branchName}</div><div className="num text-2xl">{rupiah(r.fee)}</div></div>{skema(r)}</div>
        <Segs r={r} h={10} />
        <div className="flex justify-between text-sm"><span>Terbayar <b className="num">{rupiah(r.paid)}</b>{r.pending > 0 && <span className="text-n-600"> · diperiksa {rupiah(r.pending)}</span>}</span><span className={r.sisa ? 'text-danger-fg' : 'text-n-500'}>Sisa <b className="num">{rupiah(r.sisa)}</b></span></div>
      </div>
      {r.scheme === 'BELUM_DIATUR' && r.status !== 'LUNAS' && <Alert kind="info">Skema belum diatur, jadi tagihan ini dibayar lunas seperti biasa. {can(user, 'pendaftaran.edit') ? 'Pilih Atur skema untuk mencicil.' : 'PJ RTA bisa mengatur cicilan.'}</Alert>}
      {r.status === 'MENUNGGU' && <Alert kind="info">Ada bukti yang menunggu verifikasi. <Link to="/bayar?tab=bukti" className="font-semibold underline">Buka Bukti masuk</Link></Alert>}
      <Card title={n > 1 ? 'Jadwal cicilan' : 'Pembayaran'}>
        <ol className="space-y-0">{r.installments.map((i, k) => {
          const done = i.status === 'LUNAS', late = i.status === 'TUNGGAKAN', wait = i.status === 'MENUNGGU', cur = r.next?.id === i.id;
          return (
            <li key={i.id} className="flex gap-3">
              <div className="flex flex-col items-center"><span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${done ? 'bg-success text-white' : late ? 'bg-danger-bg text-danger-fg' : wait ? 'bg-lilac-bg text-lilac-fg' : cur ? 'bg-brand-600 text-white' : 'bg-n-100 text-n-600'}`}>{done ? <Check size={15} /> : i.no}</span>{k < n - 1 && <span className="w-0.5 flex-1 bg-n-200 my-1" />}</div>
              <div className="flex-1 pb-4 min-w-0">
                <div className="flex justify-between gap-3"><b className="text-sm">{instName(i, n)}</b><b className="num text-sm">{rupiah(i.amount)}</b></div>
                <div className={`text-xs mt-0.5 ${done ? 'text-mint-fg' : late ? 'text-danger-fg font-semibold' : 'text-n-600'}`}>
                  {done ? `Dibayar ${tgl(i.paidAt)}${i.method ? ` · ${i.method === 'TUNAI' ? 'tunai' : 'transfer'}` : ''} · diverifikasi`
                    : wait ? `Bukti dikirim ${tgl(i.paidAt)} · menunggu verifikasi`
                    : i.dueDate ? `Jatuh tempo ${tgl(i.dueDate)}${late ? ` · lewat ${daysLate(i.dueDate)} hari` : i.status === 'TERJADWAL' ? ' · belum ditagihkan' : ''}` : 'Belum dibayar'}
                </div>
              </div>
            </li>);
        })}</ol>
      </Card>
      {d.maxInstallments > 1 && r.scheme === 'CICIL' && <p className="text-xs text-n-600">Cicilan muncul di menu Bayar dan halaman wali pada bulan jatuh temponya; bisa dilunasi lebih awal kapan saja.</p>}
    </Drawer>
  );
}

function PlanDrawer({ r, d, onClose, onPay }: { r: Row; d: Data; onClose: () => void; onPay: (p: Pay) => void }) {
  const qc = useQueryClient(); const toast = useToast(); const { user } = useAuth();
  const canCicil = d.maxInstallments > 1 && r.fee > d.minDp;
  const [scheme, setScheme] = useState<'LUNAS' | 'CICIL'>(canCicil ? 'CICIL' : 'LUNAS');
  const [count, setCount] = useState(String(Math.min(3, d.maxInstallments)));
  const [dp, setDp] = useState(String(d.minDp));
  const [dates, setDates] = useState<Record<number, string>>({});
  const [payNow, setPayNow] = useState(can(user, 'bayar.input'));
  const nNum = Number(count), dpNum = Number(dp) || 0;
  const err = scheme !== 'CICIL' ? '' : dpNum < d.minDp ? `DP minimal ${rupiah(d.minDp)}. Naikkan DP atau pilih lunas langsung.` : dpNum >= r.fee ? 'DP sama dengan atau melebihi biaya. Pilih lunas langsung.'
    : Math.floor((r.fee - dpNum) / (nNum - 1) / 1000) * 1000 <= 0 ? 'Sisa terlalu kecil untuk dibagi. Kurangi jumlah cicilan.' : '';
  const plan = useMemo(() => {
    if (scheme === 'LUNAS' || err) return [];
    const today = todayWIB();
    return split(r.fee, nNum, dpNum).map((amount, k) => ({ amount, dueDate: dates[k] ?? addMonthsKeepDay(today, k) }));
  }, [scheme, err, nNum, dpNum, dates, r.fee]);
  const dateErr = plan.some((p, k) => k > 0 && p.dueDate.slice(0, 7) <= plan[k - 1].dueDate.slice(0, 7)) ? 'Jatuh tempo tiap cicilan harus di bulan yang berbeda dan berurutan.' : '';
  const first = scheme === 'LUNAS' ? r.fee : plan[0]?.amount ?? 0;
  const save = useMutation({
    mutationFn: (_withPay: boolean) => post(`/registrations/${r.studentId}/plan`, scheme === 'LUNAS' ? { scheme } : { scheme, count: nNum, dp: dpNum, dueDates: plan.map((p) => p.dueDate) }),
    onSuccess: (x: any, withPay) => {
      qc.invalidateQueries({ queryKey: ['registrations'] });
      toast(scheme === 'LUNAS' ? 'Skema lunas langsung disimpan' : `Jadwal ${nNum} kali bayar disimpan`);
      if (withPay) onPay({ familyId: r.familyId, familyName: r.familyName, preselect: [x.invoices[0].id] }); else onClose();
    },
    onError: (e: any) => toast(e.message, 'danger'),
  });
  const blocked = !!err || !!dateErr || save.isPending;
  return (
    <Drawer open onClose={onClose} title="Atur pembayaran pendaftaran" sub="Pilih lunas langsung atau cicil"
      footer={<div className="flex flex-col-reverse sm:flex-row gap-2">
        {payNow && <button className="btn-secondary w-full sm:w-auto sm:flex-1" disabled={blocked} onClick={() => save.mutate(false)}>Simpan jadwal saja</button>}
        <button className="btn-primary w-full sm:w-auto sm:flex-[2]" disabled={blocked} onClick={() => save.mutate(payNow)}>{payNow ? `Simpan & catat ${scheme === 'LUNAS' ? 'pembayaran' : 'DP'} ${rupiah(first)}` : 'Simpan skema'}</button></div>}>
      <div className="card p-4 flex items-center gap-3"><Avatar name={r.fullName} /><div className="flex-1 min-w-0"><div className="font-bold truncate">{r.fullName}</div><div className="text-xs text-n-600">{r.className} · Kel. {r.familyName}</div></div><div className="text-right"><div className="text-[11px] text-n-600">Biaya pendaftaran</div><div className="num">{rupiah(r.fee)}</div></div></div>
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Skema pembayaran">
        {([['LUNAS', 'Lunas langsung', `${rupiah(r.fee)} sekali bayar`], ['CICIL', 'Cicil', canCicil ? `DP + sisa, maks. ${d.maxInstallments} kali` : 'Tidak tersedia untuk biaya ini']] as const).map(([v, t, sub]) => (
          <button key={v} role="radio" aria-checked={scheme === v} disabled={v === 'CICIL' && !canCicil} onClick={() => setScheme(v)}
            className={`text-left rounded-2xl p-3.5 min-h-[64px] border-[1.5px] transition disabled:opacity-50 ${scheme === v ? 'border-brand-600 bg-brand-50' : 'border-n-200 bg-white'}`}>
            <b className={`block text-sm ${scheme === v ? 'text-brand-700' : ''}`}>{t}</b><span className="text-xs text-n-600">{sub}</span></button>))}
      </div>
      {scheme === 'CICIL' && <>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Dicicil dalam (termasuk DP)" hint={`Maksimal ${d.maxInstallments} kali`}>
            <Segmented label="Jumlah kali bayar" value={count} onChange={(v) => { setCount(v); setDates({}); }} items={Array.from({ length: d.maxInstallments - 1 }, (_, k) => ({ value: String(k + 2), label: `${k + 2} kali` }))} />
          </Field>
          <Field label="DP (pembayaran pertama)" hint={`Minimal ${rupiah(d.minDp)}`}>
            <input className={`input ${err ? '!border-danger' : ''}`} type="number" inputMode="numeric" min={0} step={1000} value={dp} onChange={(e) => setDp(e.target.value)} aria-invalid={!!err} />
          </Field>
        </div>
        {err && <Alert>{err}</Alert>}
        {!err && <Card title={<span className="flex items-center justify-between w-full gap-3">Jadwal otomatis<span className="text-xs font-normal text-n-600">tanggal bisa diubah</span></span>}>
          <ol className="divide-y divide-n-100">{plan.map((p, k) => (
            <li key={k} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${k === 0 ? 'bg-brand-600 text-white' : 'bg-lilac-bg text-lilac-fg'}`}>{k + 1}</span>
              <div className="flex-1 min-w-[110px]"><b className="text-sm block">{k === 0 ? 'DP' : `Cicilan ${k + 1}`}</b><span className="text-xs text-n-600">{k === 0 ? 'dibayar saat daftar' : k === plan.length - 1 ? 'pelunasan' : 'sisa dibagi rata'}</span></div>
              <input type="date" className="input !h-10 !w-[150px]" aria-label={`Jatuh tempo ${k === 0 ? 'DP' : `cicilan ${k + 1}`}`} value={p.dueDate} onChange={(e) => e.target.value && setDates({ ...dates, [k]: e.target.value })} />
              <b className="num text-sm w-24 text-right">{rupiah(p.amount)}</b>
            </li>))}</ol>
          <div className="flex justify-between items-center pt-3 border-t border-n-100 text-sm"><span className="text-mint-fg font-semibold">✓ Total sama dengan biaya pendaftaran</span><b className="num">{rupiah(plan.reduce((a, p) => a + p.amount, 0))}</b></div>
          {dateErr && <Alert>{dateErr}</Alert>}
        </Card>}
      </>}
      {can(user, 'bayar.input') && <div className="card p-4 space-y-2">
        <div className="flex items-center gap-3"><div className="flex-1"><b className="text-sm">Bayar {scheme === 'LUNAS' ? '' : 'DP '}sekarang?</b><div className="text-xs text-n-600">Setelah disimpan, langsung lanjut ke catat pembayaran (bukti transfer / tunai).</div></div><Toggle label="Bayar sekarang" checked={payNow} onChange={setPayNow} /></div>
      </div>}
      <p className="text-xs text-n-600">Skema hanya bisa diubah selama belum ada pembayaran. Cicilan berikutnya muncul di menu Bayar sesuai jatuh tempo, dan bisa dilunasi lebih awal kapan saja.</p>
    </Drawer>
  );
}
