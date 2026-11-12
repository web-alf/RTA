import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { ArrowRight, ChevronLeft } from 'lucide-react';
import { can, get, patch, post, rupiah, tgl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Avatar, Badge, Card, Dialog, Drawer, Empty, Field, KV, Ring, Segmented } from '../components/ui';
import { SubsidySelect } from '../components/SubsidySelect';
import { useToast } from '../components/Toast';
import { PembelianTab } from './Kas';

const LEVEL: Record<string, string> = { JUZ30: 'Juz 30', JUZ29: 'Juz 29', JUZ28: 'Juz 28' };
const fmt = (n: number) => String(n).replace('.', ',');

export default function SantriDetail() {
  const { id } = useParams(); const { user } = useAuth(); const toast = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['student', id], queryFn: () => get(`/students/${id}`) });
  const hist = useQuery({ queryKey: ['hist', Number(id)], queryFn: () => get(`/hafalan/students/${id}`), enabled: can(user, 'kelas.lihat') });
  const inv = useQuery({ queryKey: ['st-inv', id], queryFn: () => get(`/spp/students/${id}/invoices`), enabled: can(user, 'spp.lihat') });
  const reasons = useQuery({ queryKey: ['reasons'], queryFn: () => get('/status-reasons') });
  const [tab, setTab] = useState<'ringkas' | 'hafalan' | 'tagihan' | 'pembelian' | 'riwayat'>('ringkas');
  const [dlg, setDlg] = useState<'' | 'edit' | 'status' | 'ajukan'>(''); const [err, setErr] = useState('');
  const [form, setForm] = useState<any>({});
  const s = q.data;
  const f = (k: string) => ({ value: form[k] ?? '', onChange: (e: any) => setForm({ ...form, [k]: e.target.value }) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['student', id] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const open = (d: typeof dlg) => {
    setErr(''); setDlg(d);
    if (d === 'edit') setForm({ fullName: s.fullName, nickname: s.nickname ?? '', gender: s.gender, birthPlace: s.birthPlace, birthDate: s.birthDate, registrationNote: s.registrationNote ?? '', school: s.school ?? '', healthNotes: s.healthNotes === 'Disembunyikan' ? '' : s.healthNotes ?? '', classId: s.classId, sppRate: s.sppRate, subsidyId: s.subsidyId ? String(s.subsidyId) : '' });
    if (d === 'status') setForm({ action: s.status === 'INDENT' ? 'MULAI' : s.status === 'CUTI' ? 'AKTIF' : 'CUTI', effectiveDate: new Date().toISOString().slice(0, 10), reason: '', note: '' });
  };
  const save = async () => {
    setErr('');
    try {
      if (dlg === 'edit') { const b: any = { fullName: form.fullName, nickname: form.nickname, gender: form.gender, birthPlace: form.birthPlace, birthDate: form.birthDate, registrationNote: form.registrationNote, school: form.school, healthNotes: form.healthNotes, classId: Number(form.classId) }; if (can(user, 'spp.input')) {
        // '' = tanpa subsidi (atau label lama dibiarkan), 'none' = cabut label lama, angka = kategori Pengaturan
        const v = form.subsidyId;
        if (v === 'none' || (v === '' && s.subsidyId)) b.subsidyId = null; else if (v) b.subsidyId = Number(v);
        if (!v || v === 'none') b.sppRate = Number(form.sppRate);
      } const r = await patch(`/students/${id}`, b); toast(r?.saudaraIkut ? `Tersimpan · ${r.saudaraIkut} saudara ikut diskon saudara` : r?.subsidiDicabut ? `Tersimpan · diskon saudara dicabut untuk ${r.subsidiDicabut} santri` : 'Tersimpan'); }
      if (dlg === 'status') { const r = await post(`/students/${id}/status`, form); toast(r.subsidiDicabut ? `Status diperbarui · diskon saudara dicabut untuk ${r.subsidiDicabut} santri (tarif standar mulai tagihan berikutnya)` : 'Status diperbarui'); }
      setDlg(''); refresh();
    } catch (e: any) { setErr(e.details?.join(', ') ?? e.message); }
  };
  const withdraw = async (rid: number) => { try { await post(`/requests/${rid}/withdraw`); toast('Pengajuan ditarik'); refresh(); } catch (e: any) { toast(e.message, 'danger'); } };
  if (!s) return <p className="text-sm text-n-600">Memuat…</p>;
  const pending = s.requests.find((r: any) => r.state === 'MENUNGGU');
  const last = hist.data?.[0];
  const sensitive = (v: any) => (v === 'Disembunyikan' ? <span className="text-n-500 font-normal">Disembunyikan</span> : v || '—');
  const statusLabel = s.status === 'INDENT' ? 'Mulai belajar' : s.status === 'CUTI' ? 'Kembali aktif' : 'Catat cuti';

  return (
    <div className="space-y-5">
      <Link to="/santri" className="inline-flex items-center gap-1 text-sm font-semibold"><ChevronLeft size={16} />Daftar santri</Link>
      <section className="rounded-[30px] bg-brand-50 p-5 md:p-6 flex flex-wrap items-center gap-5">
        <Avatar name={s.fullName} size={76} square />
        <div className="flex-1 min-w-[220px]"><h1 className="h1">{s.fullName}</h1><div className="text-sm text-n-600 mt-1">{s.nis} · {s.branch.name} {LEVEL[s.class.level] ?? s.class.name} · {s.age} tahun</div><div className="mt-2.5"><Badge status={s.status} /></div></div>
        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          {can(user, 'santri.edit') && s.status !== 'KELUAR' && <button className="btn flex-1 md:flex-none bg-white text-brand-800" onClick={() => open('edit')}>Edit</button>}
          {can(user, 'santri.edit') && ['INDENT', 'AKTIF', 'CUTI'].includes(s.status) && <button className="btn flex-1 md:flex-none bg-white text-butter-fg" onClick={() => open('status')}>{statusLabel}</button>}
          {can(user, 'pengajuan.input') && s.status !== 'KELUAR' && !pending && <button className="btn-primary w-full md:w-auto" onClick={() => setDlg('ajukan')}>Ajukan keluar / mutasi</button>}
        </div>
      </section>
      {pending && <div className="card p-4 flex flex-wrap items-center gap-3 bg-lilac-bg"><Badge status="MENUNGGU" /><div className="flex-1 min-w-[220px] text-sm text-lilac-fg"><b>{pending.type === 'MUTASI' ? 'Mutasi' : 'Keluar'}</b> menunggu persetujuan PJ (efektif {tgl(pending.effectiveDate)}). Sampai diputuskan, santri tetap aktif.</div>{can(user, 'pengajuan.input') && <button className="btn-secondary !h-9 !text-danger-fg" onClick={() => withdraw(pending.id)}>Tarik pengajuan</button>}</div>}

      <Segmented label="Bagian" value={tab} onChange={setTab} items={[{ value: 'ringkas', label: 'Ringkasan' }, ...(can(user, 'kelas.lihat') ? [{ value: 'hafalan' as const, label: 'Hafalan' }] : []), ...(can(user, 'spp.lihat') ? [{ value: 'tagihan' as const, label: 'Tagihan' }] : []), ...(can(user, 'kas.lihat') ? [{ value: 'pembelian' as const, label: 'Pembelian' }] : []), { value: 'riwayat', label: 'Riwayat' }]} />

      {tab === 'ringkas' && <div className="grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 grid md:grid-cols-2 gap-4">
          <div className="space-y-2"><h2 className="h2 px-1">Identitas</h2><KV rows={[['ID santri', s.nis], ['Nama panggilan', s.nickname || '—'], ['Jenis kelamin', s.gender === 'L' ? 'Laki-laki' : 'Perempuan'], ['Tempat, tgl lahir', `${s.birthPlace}, ${tgl(s.birthDate)}`], ['Sekolah', s.school || '—'], ['Tanggal bergabung', tgl(s.joinDate)], ['Keterangan pendaftaran', s.registrationNote || '—'],
            ['Tarif SPP', rupiah(s.sppRate)], ...('subsidyLabel' in s ? [['Kategori subsidi', s.subsidyLabel ? `${s.subsidyLabel}${s.subsidySince ? ` · sejak ${tgl(s.subsidySince)}` : ''}` : '—'] as [string, any]] : []), ['Catatan kesehatan', sensitive(s.healthNotes)]]} /></div>
          <div className="space-y-2"><h2 className="h2 px-1">Keluarga</h2><KV rows={[['Ayah', s.family.fatherName], ['Ibu', s.family.motherName], ...(s.family.guardianName ? [['Wali', `${s.family.guardianName} (${s.family.guardianRelation ?? ''})`] as [string, any]] : []), ['No WA wali', sensitive(s.family.waPhone)], ['Alamat', sensitive(s.family.address)], ['Pekerjaan ayah', sensitive(s.family.fatherJob)], ['Pekerjaan ibu', sensitive(s.family.motherJob)]]} />
            {s.siblings.length > 0 && <div className="card p-3.5 bg-butter-bg text-sm text-butter-fg"><b>Saudara:</b> {s.siblings.map((x: any) => `${x.fullName} (${x.status.toLowerCase()})`).join(', ')}</div>}</div>
        </div>
        <div className="space-y-4">
          {can(user, 'kelas.lihat') && <Card title="Capaian hafalan"><div className="flex items-center gap-4"><Ring size={96} label={`Capaian ${last?.percent ?? 0}%`} center={`${Math.round(last?.percent ?? 0)}%`} segments={[{ value: last?.percent ?? 0, color: '#ad1d8e' }, { value: 100 - (last?.percent ?? 0), color: '#f6edf3' }]} />
            <div className="text-sm">{last ? <><div className="font-semibold">{last.surah} ayat {last.ayat}</div><div className="text-xs text-n-600">{last.total} ayat · {tgl(last.createdAt)}</div>{hist.data[1] && <div className="text-xs font-bold text-mint-fg mt-1">+{last.total - hist.data[1].total} ayat dari input sebelumnya</div>}</> : <span className="text-n-600">Belum ada catatan</span>}</div></div></Card>}
          <Card title="Riwayat status" action={<button className="text-sm font-semibold text-brand-700" onClick={() => setTab('riwayat')}>Semua</button>}>{s.history.slice(0, 3).map((h: any, i: number, arr: any[]) => (
            <div key={h.id} className="flex gap-3"><div className="flex flex-col items-center"><span className={`w-3.5 h-3.5 rounded-full mt-1 ${i === 0 ? 'bg-brand-600' : 'bg-n-300'}`} />{i < arr.length - 1 && <span className="w-0.5 flex-1 bg-n-200 my-1" />}</div>
              <div className={`text-sm ${i < arr.length - 1 ? 'pb-4' : ''}`}><div className="font-semibold">{h.note || h.reason || h.toStatus}</div><div className="text-xs text-n-600">{tgl(h.effectiveDate)} · {h.actor ?? 'sistem'}</div></div></div>))}</Card>
          {can(user, 'spp.lihat') && <Card title="Tagihan" action={<button className="text-sm font-semibold text-brand-700" onClick={() => setTab('tagihan')}>Semua</button>}>{!inv.data?.length ? <div className="text-sm text-n-600">Belum ada tagihan.</div> : inv.data.slice(0, 3).map((i: any) => <div key={i.id} className="flex items-center justify-between gap-3 py-2 text-sm border-b border-n-100 last:border-0"><span>{i.label}</span><Badge status={i.status} /></div>)}</Card>}
        </div>
      </div>}

      {tab === 'hafalan' && <Card pad={false}>{!hist.data?.length ? <Empty text="Belum ada catatan hafalan." /> : <div className="divide-y divide-n-100">{hist.data.map((h: any) => (
        <div key={h.id} className="flex items-center gap-4 px-4 md:px-5 py-3.5 text-sm"><span className="w-24 text-n-600">{tgl(h.weekStart)}</span><span className="flex-1 font-semibold">{h.surah} ayat {h.ayat}<span className="block text-xs text-n-600 font-normal">{h.total} ayat · oleh {h.recordedBy}</span></span><b className="num">{fmt(h.percent)}%</b></div>))}</div>}</Card>}

      {tab === 'tagihan' && <Card pad={false}>{!inv.data?.length ? <Empty text="Belum ada tagihan." /> : <div className="divide-y divide-n-100">{inv.data.map((i: any) => (
        <div key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 md:px-5 py-3.5 text-sm"><span className="flex-1 min-w-[160px] font-semibold">{i.label}</span><b className="num">{rupiah(i.amount)}</b><Badge status={i.status} /></div>))}</div>}</Card>}

      {tab === 'pembelian' && <PembelianTab student={{ id: s.id, fullName: s.fullName, nickname: s.nickname, status: s.status, branchId: s.branch.id ?? s.branchId, branchName: s.branch.name, className: s.class.name }} />}
      {tab === 'riwayat' && <div className="grid md:grid-cols-2 gap-4 items-start">
        <Card title="Riwayat status">{s.history.map((h: any, i: number) => (
          <div key={h.id} className="flex gap-3"><div className="flex flex-col items-center"><span className="w-3.5 h-3.5 rounded-full mt-1 bg-brand-600" /> {i < s.history.length - 1 && <span className="w-0.5 flex-1 bg-n-200 my-1" />}</div>
            <div className="pb-4 text-sm"><div className="flex items-center gap-2"><Badge status={h.toStatus} /><span className="text-n-600 text-xs">{tgl(h.effectiveDate)}</span></div>{h.reason && <div className="mt-1">{h.reason}</div>}{h.note && <div className="text-n-600">{h.note}</div>}<div className="text-xs text-n-600">oleh {h.actor ?? 'sistem'}</div></div></div>))}</Card>
        <div className="space-y-4">
          <Card title="Riwayat penempatan">{s.placements.map((p: any) => <div key={p.id} className="text-sm py-2 border-b border-n-100 last:border-0"><b>{p.className}</b> · {tgl(p.effectiveDate)}{p.note && <span className="text-n-600"> · {p.note}</span>}</div>)}</Card>
          {s.requests.length > 0 && <Card title="Pengajuan">{s.requests.map((r: any) => <div key={r.id} className="text-sm py-2 border-b border-n-100 last:border-0 flex flex-wrap gap-2 items-center"><Badge status={r.state} /><span>{r.type === 'MUTASI' ? 'Mutasi' : 'Keluar'} · {tgl(r.effectiveDate)} · {r.reason}</span>{r.decisionNote && <div className="w-full text-n-600">Catatan PJ: {r.decisionNote}</div>}</div>)}</Card>}
        </div></div>}

      <Dialog open={dlg === 'edit'} onClose={() => setDlg('')} title="Edit data santri">
        <div className="space-y-4">{err && <Alert>{err}</Alert>}
          <Field label="Nama lengkap"><input className="input" {...f('fullName')} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Nama panggilan"><input className="input" {...f('nickname')} /></Field><Field label="Jenis kelamin"><select className="input" {...f('gender')}><option value="P">Perempuan</option><option value="L">Laki-laki</option></select></Field></div>
          <div className="grid grid-cols-2 gap-3"><Field label="Tempat lahir"><input className="input" {...f('birthPlace')} /></Field><Field label="Tanggal lahir"><input className="input" type="date" {...f('birthDate')} /></Field></div>
          <Field label="Keterangan pendaftaran"><input className="input" {...f('registrationNote')} /></Field>
          <Field label="Sekolah"><input className="input" {...f('school')} /></Field><Field label="Catatan kesehatan"><input className="input" {...f('healthNotes')} /></Field>
          {can(user, 'pengajuan.setujui') && <Field label="Kelas (kenaikan jenjang, hanya PJ)"><select className="input" {...f('classId')}><option value={s.classId}>{s.class.name}</option>{(s.branchClasses ?? []).filter((c: any) => c.id !== s.classId).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
          {can(user, 'spp.input') && <div className="space-y-4">
            <SubsidySelect branchId={s.branchId} value={form.subsidyId ?? ''} legacy={s.subsidyId ? null : s.subsidyLabel} onChange={(v) => setForm({ ...form, subsidyId: v })} />
            {(!form.subsidyId || form.subsidyId === 'none') && <Field label="Tarif SPP khusus" hint={`Tanpa subsidi; tarif standar cabang ${rupiah(s.branch.sppStandard)}. Berlaku mulai tagihan berikutnya.`}><input className="input" type="number" min={0} step={1000} {...f('sppRate')} /></Field>}
          </div>}
          <div className="flex gap-3 pt-1"><button className="btn-soft flex-1" onClick={() => setDlg('')}>Batal</button><button className="btn-primary flex-1" onClick={save}>Simpan</button></div></div></Dialog>

      <Dialog open={dlg === 'status'} onClose={() => setDlg('')} title={statusLabel}>
        <div className="space-y-4">{err && <Alert>{err}</Alert>}
          <Field label={form.action === 'CUTI' ? 'Tanggal mulai cuti' : 'Tanggal efektif'}><input className="input" type="date" {...f('effectiveDate')} /></Field>
          {form.action === 'CUTI' && <Field label="Alasan"><select className="input" {...f('reason')}><option value="">Pilih alasan</option>{reasons.data?.filter((r: any) => r.kind === 'CUTI').map((r: any) => <option key={r.id} value={r.label}>{r.label}</option>)}</select></Field>}
          <Field label="Catatan (opsional)"><input className="input" {...f('note')} /></Field>
          <p className="text-xs text-n-600">Berlaku langsung dan tercatat di riwayat.{form.action === 'CUTI' && ' Selama cuti, SPP tidak ditagih.'}</p>
          <div className="flex gap-3"><button className="btn-soft flex-1" onClick={() => setDlg('')}>Batal</button><button className="btn-primary flex-1" onClick={save}>Simpan</button></div></div></Dialog>

      {dlg === 'ajukan' && <AjukanDrawer s={s} reasons={reasons.data ?? []} onClose={() => setDlg('')} onDone={() => { setDlg(''); refresh(); }} />}
    </div>
  );
}

function AjukanDrawer({ s, reasons, onClose, onDone }: { s: any; reasons: any[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const branches = useQuery({ queryKey: ['branches-all'], queryFn: () => get('/branches?semua=1') });
  const [type, setType] = useState<'KELUAR' | 'MUTASI'>('MUTASI');
  const [bid, setBid] = useState<number | null>(null); const [cid, setCid] = useState('');
  const [date, setDate] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1, 12).toISOString().slice(0, 10); });
  const [reason, setReason] = useState(''); const [note, setNote] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const target = branches.data?.find((b: any) => b.id === bid);
  const sameLevel = target?.classes.find((c: any) => c.level === s.class.level);
  const submit = async () => {
    setErr(''); setBusy(true);
    try { await post(`/students/${s.id}/requests`, { type, effectiveDate: date, reason, note: note || undefined, ...(type === 'MUTASI' ? { targetBranchId: bid, targetClassId: Number(cid) } : {}) }); toast('Pengajuan terkirim ke PJ RTA'); onDone(); }
    catch (e: any) { setErr(e.details?.join(', ') ?? e.message); } finally { setBusy(false); }
  };
  const ok = reason && date && (type === 'KELUAR' || (bid && cid));
  return (
    <Drawer open onClose={onClose} title="Ajukan perubahan status" sub="Dikirim ke PJ RTA untuk disetujui"
      footer={<div className="space-y-2.5"><p className="text-xs text-n-600">Selama menunggu, {s.nickname || s.fullName.split(' ')[0]} tetap dihitung aktif di {s.branch.name}. Hanya satu pengajuan menunggu per santri.</p><div className="flex gap-3"><button className="btn-secondary flex-1" onClick={onClose}>Batal</button><button className="btn-primary flex-[2]" disabled={!ok || busy} onClick={submit}>Kirim pengajuan ke PJ</button></div></div>}>
      {err && <Alert>{err}</Alert>}
      <div className="card p-4 flex items-center gap-3"><Avatar name={s.fullName} size={44} /><div className="flex-1"><div className="font-bold">{s.fullName}</div><div className="text-xs text-n-600">{s.nis} · {s.class.name} · {s.status === 'AKTIF' ? 'Aktif' : s.status}</div></div></div>
      <div><span className="label">Jenis pengajuan</span><div role="radiogroup" className="grid grid-cols-2 gap-3">
        {([['KELUAR', 'Keluar', 'Berhenti dari RTA'], ['MUTASI', 'Mutasi', 'Pindah ke cabang lain']] as const).map(([v, l, d]) => (
          <button key={v} role="radio" aria-checked={type === v} onClick={() => { setType(v); setReason(''); }} className={`text-left rounded-2xl p-3.5 ${type === v ? 'border-2 border-brand-600 bg-brand-50 shadow-[0_6px_14px_rgba(173,29,142,.15)]' : 'bg-white shadow-soft'}`}><div className={`font-bold ${type === v ? 'text-brand-700' : ''}`}>{l}</div><div className="text-xs text-n-600">{d}</div></button>))}</div></div>
      {type === 'MUTASI' && <div><span className="label">Cabang tujuan</span><div role="radiogroup" className="grid grid-cols-2 gap-3">
        {branches.data?.map((b: any) => { const cur = b.id === s.branchId; const on = b.id === bid; return (
          <button key={b.id} role="radio" aria-checked={on} disabled={cur} onClick={() => { setBid(b.id); setCid(String(b.classes.find((c: any) => c.level === s.class.level)?.id ?? '')); }}
            className={`text-left rounded-2xl p-3.5 ${on ? 'border-2 border-brand-600 bg-brand-50' : cur ? 'border-[1.5px] border-dashed border-n-300 bg-n-50 opacity-70' : 'bg-white shadow-soft'}`}>
            <div className="flex justify-between gap-2"><b className="text-sm">{b.name}</b><span className="text-[11px] font-bold text-n-600">{cur ? 'Sekarang' : on ? 'Dipilih' : ''}</span></div>
            <div className="text-xs text-n-600 mt-1">{b.classes.map((c: any) => LEVEL[c.level] ?? c.level).join(', ')} · SPP {rupiah(b.sppStandard)}</div></button>); })}</div></div>}
      <div className="grid grid-cols-2 gap-3">
        {type === 'MUTASI' && <Field label="Kelas tujuan"><select className="input" value={cid} onChange={(e) => setCid(e.target.value)} disabled={!target}><option value="">Pilih</option>{target?.classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        <Field label="Tanggal efektif"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label="Alasan"><select className="input" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Pilih alasan</option>{reasons.filter((r) => r.kind === type).map((r) => <option key={r.id} value={r.label}>{r.label}</option>)}</select></Field>
      <Field label="Catatan untuk PJ (opsional)"><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {type === 'MUTASI' && target && <div className="card p-4 space-y-2.5 text-[13px]"><b className="text-sm">Setelah PJ menyetujui</b>
        <div className="flex gap-2.5"><span className="w-6 h-6 rounded-lg bg-rose-bg text-rose-fg flex items-center justify-center shrink-0"><ArrowRight size={13} /></span>Pindah ke {target.name} {cid ? target.classes.find((c: any) => String(c.id) === cid)?.name.replace(target.name, '').trim() : ''} mulai {tgl(date)}{!sameLevel && ' (jenjang yang sama tidak tersedia, pilih kelas lain)'}</div>
        <div className="flex gap-2.5"><span className="w-6 h-6 rounded-lg bg-butter-bg text-butter-fg flex items-center justify-center shrink-0 font-bold">Rp</span>SPP mengikuti {target.name}: {rupiah(s.sppRate)} → {rupiah(target.sppStandard)}</div>
        <div className="flex gap-2.5"><span className="w-6 h-6 rounded-lg bg-lilac-bg text-lilac-fg flex items-center justify-center shrink-0 font-bold">+</span>Biaya pindah Rp100.000 (daftar ulang tahun ini; tidak ditagih dua kali)</div>
        <div className="flex gap-2.5"><span className="w-6 h-6 rounded-lg bg-mint-bg text-mint-fg flex items-center justify-center shrink-0 font-bold">✓</span>Riwayat hafalan & keuangan ikut pindah</div></div>}
    </Drawer>
  );
}
