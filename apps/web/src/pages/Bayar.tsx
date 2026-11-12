import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, MessageCircle, Upload, Wallet } from 'lucide-react';
import { api, can, get, post, rupiah, tgl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { compressImage, sizeLabel } from '../lib/image';
import { useToast } from '../components/Toast';
import { Alert, Avatar, Badge, Card, Chips, Dialog, Drawer, Empty, Field, PageHeader, SearchBox, Segmented } from '../components/ui';

type Fam = { id: number; fatherName: string; kids: string[]; total: number; count: number; status: string; lastSent: string | null; pending: number; waPhone?: string };

export default function Bayar() {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as 'kirim' | 'bukti' | 'riwayat') ?? 'kirim';
  const pend = useQuery({ queryKey: ['payments', 'MENUNGGU'], queryFn: () => get('/bayar/payments?state=MENUNGGU') });
  const [upload, setUpload] = useState<number | true | null>(null);
  return (
    <div className="space-y-5">
      <PageHeader title="Pembayaran" sub="Kirim tagihan ke wali, terima bukti, lalu verifikasi"
        actions={can(user, 'bayar.input') && <button className="btn-secondary" onClick={() => setUpload(true)}><Upload size={16} />Upload bukti WA / catat tunai</button>} />
      <ol aria-label="Alur pembayaran" className="hidden md:grid grid-cols-4 gap-3">
        {[['1', 'Tagihan dibuat', 'otomatis tanggal 1', 'bg-rose-bg', 'text-rose-fg'], ['2', 'Kirim ke WA wali', 'satu, terpilih, atau semua', 'bg-butter-bg', 'text-butter-fg'], ['3', 'Bukti masuk', 'lewat link web atau WA', 'bg-lilac-bg', 'text-lilac-fg'], ['4', 'Verifikasi', 'cocokkan mutasi bank', 'bg-mint-bg', 'text-mint-fg']].map(([n, t, s, bg, fg]) => (
          <li key={n} className={`${bg} rounded-2xl p-3.5 flex items-center gap-3`}><span className={`w-8 h-8 rounded-xl bg-white ${fg} flex items-center justify-center num`}>{n}</span><span className="text-[13px]"><b className="block text-sm">{t}</b>{s}</span></li>))}
      </ol>
      <Segmented label="Bagian" value={tab} onChange={(v) => setSp({ tab: v })} items={[{ value: 'kirim', label: 'Kirim tagihan' }, { value: 'bukti', label: `Bukti masuk${pend.data?.length ? ` · ${pend.data.length}` : ''}` }, { value: 'riwayat', label: 'Riwayat' }]} />
      {tab === 'kirim' && <Kirim onUpload={(id) => setUpload(id)} />}
      {tab === 'bukti' && <Bukti rows={pend.data ?? []} loading={pend.isLoading} />}
      {tab === 'riwayat' && <Riwayat />}
      {upload !== null && <UploadDrawer familyId={upload === true ? null : upload} onClose={() => setUpload(null)} />}
    </div>
  );
}

function Kirim({ onUpload }: { onUpload: (id: number) => void }) {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const fams = useQuery({ queryKey: ['families-bayar', q], queryFn: () => get<Fam[]>(`/bayar/families${q ? `?q=${encodeURIComponent(q)}` : ''}`) });
  const [sel, setSel] = useState<number[]>([]);
  const [queue, setQueue] = useState<number[] | null>(null);
  const list = (fams.data ?? []).filter((f) => f.total > 0);
  const canSend = can(user, 'bayar.input');
  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <>
      <div className="flex flex-col md:flex-row gap-3 md:items-center">
        <SearchBox value={q} onChange={setQ} placeholder="Cari keluarga" className="md:w-80" />
        {canSend && list.length > 0 && <div className="flex gap-2 md:ml-auto">
          <button className="btn-secondary flex-1 md:flex-none" disabled={!sel.length} onClick={() => setQueue(sel)}>Kirim terpilih ({sel.length})</button>
          <button className="btn-primary flex-1 md:flex-none" onClick={() => setQueue(list.map((f) => f.id))}>Kirim semua ({list.length})</button></div>}
      </div>
      {fams.isLoading ? <div className="text-sm text-n-600">Memuat…</div> : list.length === 0 ? <Card><Empty icon={CheckCircle2} text="Alhamdulillah, tidak ada tagihan yang perlu dikirim." /></Card> :
        <div className="space-y-3">{list.map((f) => (
          <div key={f.id} className={`card px-4 py-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 ${sel.includes(f.id) ? 'ring-2 ring-brand-200' : ''}`}>
            {canSend && <input type="checkbox" aria-label={`Pilih Kel. ${f.fatherName}`} checked={sel.includes(f.id)} onChange={() => toggle(f.id)} className="w-5 h-5 accent-brand-600" />}
            <Avatar name={f.fatherName} />
            <div className="flex-1 min-w-[160px]"><div className="font-bold">Kel. {f.fatherName}</div><div className="text-xs text-n-600">{f.kids.join(' & ')} · {f.count} tagihan</div></div>
            <div className="text-right md:w-32"><div className="num">{rupiah(f.total)}</div><div className="text-[11px] text-n-600">{f.lastSent ? `Dikirim ${tgl(f.lastSent)}` : 'Belum pernah dikirim'}</div></div>
            <Badge status={f.status} />
            {canSend && <div className="flex gap-2 w-full md:w-auto"><button className="btn-soft !h-9 flex-1" onClick={() => onUpload(f.id)}>Catat bayar</button><button className="btn-wa !h-9 flex-1" onClick={() => setQueue([f.id])}><MessageCircle size={15} />Kirim WA</button></div>}
          </div>))}</div>}
      {sel.length > 0 && <div className="md:hidden fixed inset-x-3 bottom-[92px] z-30 bg-brand-600 text-white rounded-2xl shadow-brand flex items-center gap-3 pl-5 pr-2 py-2"><span className="flex-1 text-sm font-bold">{sel.length} keluarga dipilih</span><button className="btn bg-white text-brand-700 !h-10" onClick={() => setQueue(sel)}>Kirim via WA</button></div>}
      {queue && <WaQueue ids={queue} fams={fams.data ?? []} onClose={() => { setQueue(null); setSel([]); }} />}
    </>
  );
}

function WaQueue({ ids, fams, onClose }: { ids: number[]; fams: Fam[]; onClose: () => void }) {
  const qc = useQueryClient(); const toast = useToast();
  const [i, setI] = useState(0);
  const f = fams.find((x) => x.id === ids[i]);
  const inv = useQuery({ queryKey: ['fam-inv', f?.id], queryFn: () => get(`/bayar/families/${f!.id}/invoices`), enabled: !!f });
  const preview = useMemo(() => {
    if (!inv.data?.length) return '';
    const names = [...new Set(inv.data.map((x: any) => x.student))].join(' & ');
    const spp = inv.data.filter((x: any) => x.type === 'SPP').map((x: any) => x.label.replace('SPP ', '').split(' ')[0]);
    const what = spp.length ? `SPP ${spp.length > 1 ? `${spp[0]}–${spp[spp.length - 1]}` : spp[0]}` : inv.data[0].label;
    return `Assalamu'alaikum Bapak/Ibu 🌿\nTagihan ${what} untuk ${names}: ${rupiah(inv.data.reduce((a: number, x: any) => a + x.amount, 0))}.\nRincian dan unggah bukti transfer: (link unik dibuat saat dikirim)\nJazakumullahu khairan 🤍`;
  }, [inv.data]);
  const advance = () => { if (i + 1 < ids.length) setI(i + 1); else { qc.invalidateQueries({ queryKey: ['families-bayar'] }); toast('Antrean selesai'); onClose(); } };
  const send = async () => {
    const w = window.open('', '_blank'); // dibuka langsung saat diklik agar tidak diblokir browser
    try { const d = await post(`/bayar/families/${f!.id}/link`); if (w) w.location.href = d.waUrl; else window.location.href = d.waUrl; advance(); }
    catch (e: any) { w?.close(); toast(e.message, 'danger'); }
  };
  if (!f) return null;
  return (
    <Drawer open onClose={onClose} title="Kirim tagihan" sub={`${i + 1} dari ${ids.length} keluarga`}
      footer={<div className="space-y-2"><button className="btn w-full bg-success text-white shadow-[0_8px_18px_rgba(31,122,77,.28)]" onClick={send} disabled={!preview}><MessageCircle size={17} />Buka WhatsApp</button>
        {ids.length > 1 && <button className="btn-secondary w-full" onClick={advance}>Lewati{ids[i + 1] ? `, ke Kel. ${fams.find((x) => x.id === ids[i + 1])?.fatherName}` : ''}</button>}</div>}>
      <div className="h-2 rounded-full bg-n-200"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${((i + 1) / ids.length) * 100}%` }} /></div>
      <div className="card p-4 space-y-4">
        <div className="flex items-center gap-3"><Avatar name={f.fatherName} /><div><div className="font-bold">Kel. {f.fatherName}</div><div className="text-xs text-n-600">{f.kids.join(' & ')} · {rupiah(f.total)}</div></div></div>
        {inv.isLoading ? <div className="text-sm text-n-600">Menyiapkan pesan…</div> : <div className="whitespace-pre-line px-4 py-3.5 rounded-[18px] rounded-bl-md bg-[#e7f6ec] text-[13px] leading-relaxed text-[#1f2d24]">{preview}</div>}
      </div>
      <p className="text-xs text-n-600">Link berlaku 30 hari dan hanya menampilkan tagihan keluarga ini. Pesan tidak menyebut kategori subsidi. WhatsApp tidak mengizinkan kirim massal otomatis dari browser, jadi tiap keluarga dibuka satu per satu.</p>
    </Drawer>
  );
}

function Proof({ id }: { id: number }) {
  const [url, setUrl] = useState<string | null>(null); const [pdf, setPdf] = useState(false);
  useEffect(() => { let u: string; api<Blob>(`/bayar/payments/${id}/proof`).then((b) => { setPdf(b.type === 'application/pdf'); u = URL.createObjectURL(b); setUrl(u); }).catch(() => {}); return () => { if (u) URL.revokeObjectURL(u); }; }, [id]);
  if (!url) return <div className="w-16 h-20 rounded-xl bg-n-100 shrink-0" />;
  return <a href={url} target="_blank" rel="noreferrer" aria-label="Buka bukti" className="w-16 h-20 rounded-xl overflow-hidden bg-n-50 shrink-0 flex items-center justify-center">{pdf ? <FileText className="text-brand-700" /> : <img src={url} alt="Bukti transfer" className="w-full h-full object-cover" />}</a>;
}

function Bukti({ rows, loading }: { rows: any[]; loading: boolean }) {
  const { user } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const [reject, setReject] = useState<any>(null); const [reason, setReason] = useState('');
  const verify = useMutation({ mutationFn: (id: number) => post(`/bayar/payments/${id}/verify`), onSuccess: () => { toast('Pembayaran diverifikasi'); qc.invalidateQueries(); } });
  const cancel = useMutation({ mutationFn: () => post(`/bayar/payments/${reject.id}/cancel`, { reason }), onSuccess: () => { toast('Bukti ditolak'); setReject(null); setReason(''); qc.invalidateQueries(); }, onError: (e: any) => toast(e.message, 'danger') });
  const canVerify = can(user, 'bayar.setujui');
  if (loading) return <div className="text-sm text-n-600">Memuat…</div>;
  if (!rows.length) return <Card><Empty icon={CheckCircle2} text="Tidak ada bukti yang menunggu verifikasi." /></Card>;
  return (
    <div className="space-y-3">
      {!canVerify && <Alert kind="info">Bukti diverifikasi oleh PJ RTA setelah dicocokkan dengan mutasi bank.</Alert>}
      <div className="grid md:grid-cols-2 gap-3">{rows.map((p) => (
        <div key={p.id} className="card p-4 flex flex-col gap-3">
          <div className="flex gap-3">{p.hasProof ? <Proof id={p.id} /> : <div className="w-16 h-20 rounded-xl bg-butter-bg text-butter-fg shrink-0 flex items-center justify-center"><Wallet /></div>}
            <div className="flex-1 min-w-0"><div className="font-bold">Kel. {p.fatherName}</div><div className="text-xs text-n-600 line-clamp-2">{p.items}</div><div className="num text-xl mt-1">{rupiah(p.amount)}</div>
              <div className="flex flex-wrap gap-1.5 mt-1"><span className="pill bg-lilac-bg text-lilac-fg">via {p.source === 'WEB' ? 'link wali' : p.source === 'WA' ? 'WA' : 'tunai'}</span><span className="pill bg-n-50 text-n-700">{tgl(p.paidAt)}</span></div></div></div>
          {p.recordedBy && <div className="text-xs text-n-600">Dicatat {p.recordedBy}{p.note ? ` · ${p.note}` : ''}</div>}
          {canVerify && <div className="flex gap-2"><button className="btn-secondary flex-1 !text-danger-fg" onClick={() => setReject(p)}>Tolak</button><button className="btn flex-[2] bg-success text-white hover:brightness-110" disabled={verify.isPending} onClick={() => verify.mutate(p.id)}>Verifikasi</button></div>}
        </div>))}</div>
      <Dialog open={!!reject} onClose={() => setReject(null)} title="Tolak bukti pembayaran">
        <Field label="Alasan (wajib, akan dicatat)"><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. nominal tidak ada di mutasi bank" /></Field>
        <div className="flex gap-3 mt-5"><button className="btn-soft flex-1" onClick={() => setReject(null)}>Batal</button><button className="btn-danger flex-1" disabled={reason.trim().length < 3 || cancel.isPending} onClick={() => cancel.mutate()}>Tolak bukti</button></div>
      </Dialog>
    </div>
  );
}

function Riwayat() {
  const { user } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const [state, setState] = useState('TERVERIFIKASI');
  const q = useQuery({ queryKey: ['payments', state], queryFn: () => get(`/bayar/payments?state=${state}`) });
  const [c, setC] = useState<any>(null); const [reason, setReason] = useState('');
  const cancel = useMutation({ mutationFn: () => post(`/bayar/payments/${c.id}/cancel`, { reason }), onSuccess: () => { toast('Pembayaran dibatalkan'); setC(null); setReason(''); qc.invalidateQueries(); }, onError: (e: any) => toast(e.message, 'danger') });
  return (
    <div className="space-y-3">
      <Chips label="Filter status" value={state} onChange={setState} items={[{ value: 'TERVERIFIKASI', label: 'Terverifikasi' }, { value: 'DIBATALKAN', label: 'Dibatalkan' }]} />
      <Card pad={false}>{!q.data?.length ? <Empty text={q.isLoading ? 'Memuat…' : 'Belum ada data.'} /> :
        <div className="divide-y divide-n-100">{q.data.map((p: any) => (
          <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 md:px-5 py-3.5">
            <div className="flex-1 min-w-[200px]"><div className="font-semibold">Kel. {p.fatherName}</div><div className="text-xs text-n-600 line-clamp-1">{p.items}</div>{p.cancelReason && <div className="text-xs text-danger-fg">Alasan: {p.cancelReason}</div>}</div>
            <div className="text-xs text-n-600 w-36">{tgl(p.paidAt)} · {p.method === 'TUNAI' ? 'tunai' : 'transfer'}{p.verifiedBy ? ` · ${p.verifiedBy}` : ''}</div>
            <b className="num w-28 text-right">{rupiah(p.amount)}</b>
            {state === 'TERVERIFIKASI' && can(user, 'bayar.setujui') && <button className="btn-text !h-9 !text-danger-fg" onClick={() => setC(p)}>Batalkan</button>}
          </div>))}</div>}</Card>
      <Dialog open={!!c} onClose={() => setC(null)} title="Batalkan pembayaran">
        <Alert kind="warning">Entri tidak dihapus. Tagihan terkait kembali berstatus belum dibayar.</Alert>
        <div className="mt-4"><Field label="Alasan (wajib)"><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
        <div className="flex gap-3 mt-5"><button className="btn-soft flex-1" onClick={() => setC(null)}>Batal</button><button className="btn-danger flex-1" disabled={reason.trim().length < 3 || cancel.isPending} onClick={() => cancel.mutate()}>Batalkan pembayaran</button></div>
      </Dialog>
    </div>
  );
}

/** Catat pembayaran (bukti WA / tunai). Dipakai juga menu Pendaftaran: preselect = tagihan yang langsung dicentang (mis. DP / lunasi sisa). */
export function UploadDrawer({ familyId, onClose, preselect, familyName }: { familyId: number | null; onClose: () => void; preselect?: number[]; familyName?: string }) {
  const { user } = useAuth(); const qc = useQueryClient(); const toast = useToast();
  const [fid, setFid] = useState<number | null>(familyId);
  const [q, setQ] = useState('');
  const fams = useQuery({ queryKey: ['families-bayar', q], queryFn: () => get<Fam[]>(`/bayar/families${q ? `?q=${encodeURIComponent(q)}` : ''}`), enabled: !fid });
  const fam = useQuery({ queryKey: ['families-bayar', ''], queryFn: () => get<Fam[]>('/bayar/families'), enabled: !!fid });
  const inv = useQuery({ queryKey: ['fam-inv', fid, 'terjadwal'], queryFn: () => get(`/bayar/families/${fid}/invoices?terjadwal=1`), enabled: !!fid });
  const [chosen, setChosen] = useState<number[]>([]);
  // bawaan: semua yang sudah jatuh tempo; cicilan terjadwal hanya bila dipilih (lunasi lebih awal)
  useEffect(() => { if (inv.data) setChosen(preselect ?? inv.data.filter((x: any) => x.status !== 'TERJADWAL').map((x: any) => x.id)); }, [inv.data]);
  const [method, setMethod] = useState<'TRANSFER' | 'TUNAI'>('TRANSFER');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null); const [orig, setOrig] = useState(0);
  const [matched, setMatched] = useState(false); const [note, setNote] = useState('');
  const amount = (inv.data ?? []).filter((x: any) => chosen.includes(x.id)).reduce((a: number, x: any) => a + x.amount, 0);
  const f = fam.data?.find((x) => x.id === fid) ?? (fid && familyName ? { fatherName: familyName, kids: [...new Set<string>((inv.data ?? []).map((x: any) => x.student))] } : undefined);
  const canVerify = can(user, 'bayar.setujui');
  const save = useMutation({
    mutationFn: () => { const fd = new FormData(); fd.append('familyId', String(fid)); fd.append('invoiceIds', chosen.join(',')); fd.append('amount', String(amount)); fd.append('paidAt', paidAt); fd.append('method', method); fd.append('matched', String(matched)); if (note) fd.append('note', note); if (file) fd.append('file', file); return post('/bayar/payments', fd); },
    onSuccess: (d: any) => { toast(d.state === 'TERVERIFIKASI' ? 'Pembayaran tercatat & terverifikasi' : 'Tercatat, menunggu verifikasi PJ'); qc.invalidateQueries(); onClose(); },
    onError: (e: any) => toast(e.message, 'danger'),
  });
  const pickFile = async (fl?: File) => { if (!fl) return; setOrig(fl.size); setFile(await compressImage(fl)); };
  return (
    <Drawer open onClose={onClose} title={method === 'TUNAI' ? 'Catat pembayaran tunai' : 'Upload bukti dari WA'} sub="Untuk wali yang mengirim bukti lewat WhatsApp atau membayar tunai"
      footer={fid ? <button className="btn-primary w-full" disabled={!chosen.length || (method === 'TRANSFER' && !file) || save.isPending} onClick={() => save.mutate()}>Simpan · {rupiah(amount)}</button> : undefined}>
      {!fid ? (<>
        <SearchBox value={q} onChange={setQ} placeholder="Cari keluarga" />
        <div className="space-y-2">{fams.data?.filter((x) => x.total > 0).map((x) => <button key={x.id} onClick={() => setFid(x.id)} className="card w-full flex items-center gap-3 p-3.5 text-left"><Avatar name={x.fatherName} /><div className="flex-1"><div className="font-bold text-sm">Kel. {x.fatherName}</div><div className="text-xs text-n-600">{x.kids.join(' & ')}</div></div><b className="num text-sm">{rupiah(x.total)}</b></button>)}</div>
      </>) : (<>
        <div className="card p-4 flex items-center gap-3"><Avatar name={f?.fatherName ?? ''} /><div className="flex-1"><div className="font-bold">Kel. {f?.fatherName}</div><div className="text-xs text-n-600">{f?.kids.join(' & ')}</div></div>{!familyId && <button className="btn-text !h-8" onClick={() => setFid(null)}>Ganti</button>}</div>
        <Segmented label="Cara bayar" value={method} onChange={setMethod} items={[{ value: 'TRANSFER', label: 'Transfer (bukti WA)' }, { value: 'TUNAI', label: 'Tunai' }]} />
        <div className="card p-4 space-y-2"><div className="label !mb-1">Tagihan yang dibayar</div>
          {inv.data?.map((x: any) => <label key={x.id} className="flex items-center gap-3 py-1.5 text-sm"><input type="checkbox" className="w-5 h-5 accent-brand-600" checked={chosen.includes(x.id)} onChange={() => setChosen((c) => (c.includes(x.id) ? c.filter((y) => y !== x.id) : [...c, x.id]))} /><span className="flex-1">{x.label} · {x.student}{x.status === 'TERJADWAL' && <span className="block text-xs text-n-600">Terjadwal · jatuh tempo {tgl(x.dueDate)} (lunasi lebih awal)</span>}</span><b className="num">{rupiah(x.amount)}</b></label>)}
          <div className="text-xs text-n-600 pt-1">Pembayaran sebagian belum didukung; nominal mengikuti tagihan yang dicentang.</div></div>
        <Field label="Tanggal bayar"><input type="date" className="input" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Field>
        {method === 'TRANSFER' && <label className="flex items-center gap-3 p-3.5 rounded-2xl border-2 border-dashed border-brand-200 bg-white cursor-pointer">
          <span className="w-12 h-14 rounded-xl bg-n-50 text-brand-700 flex items-center justify-center shrink-0"><Upload size={20} /></span>
          <span className="flex-1 text-sm">{file ? <><b className="block">{file.name}</b><span className="text-mint-fg text-xs font-semibold">{sizeLabel(orig)} → {sizeLabel(file.size)} setelah dikompres</span></> : <><b className="block">Pilih foto/PDF bukti</b><span className="text-xs text-n-600">JPG, PNG, WebP, atau PDF</span></>}</span>
          <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0])} /></label>}
        <Field label="Catatan (opsional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. dikirim wali tgl 26 Okt" /></Field>
        {canVerify ? <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="w-5 h-5 accent-brand-600" checked={matched} onChange={(e) => setMatched(e.target.checked)} />Sudah dicocokkan dengan mutasi bank (langsung terverifikasi)</label>
          : <Alert kind="info">Setelah disimpan, PJ RTA akan memverifikasi dengan mutasi bank.</Alert>}
      </>)}
    </Drawer>
  );
}
