import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { House } from 'lucide-react';
import { can, get, patch, rupiah } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Avatar, Badge, Drawer, Empty, Field, KV, PageHeader, SearchBox } from '../components/ui';
import { useToast } from '../components/Toast';

const F = [['fatherName', 'Nama ayah'], ['motherName', 'Nama ibu'], ['guardianName', 'Nama wali'], ['guardianRelation', 'Hubungan wali'], ['waPhone', 'No. WA utama'], ['backupPhone', 'No. HP cadangan'], ['address', 'Alamat'], ['fatherJob', 'Pekerjaan ayah'], ['motherJob', 'Pekerjaan ibu']];
/** Data impor lama boleh tanpa nama ayah/ibu: label keluarga jatuh ke nama ibu, lalu penanda belum diisi. */
const famName = (f: any) => f?.fatherName || f?.motherName || '(nama wali belum diisi)';
const parents = (f: any) => [f.fatherName, f.motherName].filter(Boolean).join(' & ') || 'Nama orang tua belum diisi';
const KID: Record<string, string> ={ AKTIF: 'bg-mint-bg text-mint-fg', CUTI: 'bg-butter-bg text-butter-fg', INDENT: 'bg-lilac-bg text-lilac-fg', KELUAR: 'bg-n-100 text-n-700' };

export default function Wali() {
  const { user } = useAuth(); const toast = useToast(); const qc = useQueryClient();
  const [term, setTerm] = useState(''); const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['families', q], queryFn: () => get(`/families?q=${encodeURIComponent(q)}`) });
  const [sel, setSel] = useState<any>(null); const [form, setForm] = useState<any>({}); const [err, setErr] = useState('');
  const detail = useQuery({ queryKey: ['family', sel?.id], queryFn: () => get(`/families/${sel.id}`), enabled: !!sel });
  const edit = () => { const d = detail.data; const f: any = {}; for (const [k] of F) f[k] = d[k] === 'Disembunyikan' ? '' : d[k] ?? ''; setForm(f); setErr(''); };
  const save = async () => { setErr(''); try { const b: any = {}; for (const k of Object.keys(form)) if (form[k] !== '') b[k] = form[k]; await patch(`/families/${sel.id}`, b); toast('Tersimpan'); setForm({}); qc.invalidateQueries({ queryKey: ['family', sel.id] }); qc.invalidateQueries({ queryKey: ['families'] }); } catch (e: any) { setErr(e.details?.join(', ') ?? e.message); } };
  const editing = Object.keys(form).length > 0;
  const d = detail.data;
  return (
    <div className="space-y-5">
      <PageHeader title="Wali santri" sub={<>Satu keluarga bisa punya lebih dari satu santri. Wali baru dibuat dari form <Link to="/santri/baru" className="font-semibold">Tambah santri</Link>.</>} />
      <form onSubmit={(e) => { e.preventDefault(); setQ(term); }} className="md:w-96"><SearchBox value={term} onChange={(v) => { setTerm(v); if (!v) setQ(''); }} placeholder="Cari nama ayah/ibu atau no. WA" /></form>
      {list.data && !list.data.length ? <Empty icon={House} text="Belum ada data wali yang cocok." /> :
        <div className="space-y-3">{list.data?.map((f: any) => (
          <button key={f.id} onClick={() => { setSel(f); setForm({}); }} className={`card w-full text-left px-4 py-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 ${sel?.id === f.id ? 'ring-2 ring-brand-200' : ''}`}>
            <span className="w-12 h-12 rounded-2xl bg-butter-bg text-butter-fg flex items-center justify-center shrink-0"><House size={22} /></span>
            <div className="flex-1 min-w-[180px]"><div className="font-display font-extrabold">Kel. {famName(f)}</div><div className="text-xs text-n-600 truncate">{parents(f)}{f.waPhone && f.waPhone !== 'Disembunyikan' ? ` · ${f.waPhone}` : f.waPhone === null ? ' · No. WA belum diisi' : ''}</div></div>
            <div className="flex flex-wrap gap-1.5 flex-[2] min-w-[200px]">{f.kids.map((k: any) => <span key={k.id} className={`pill h-[30px] ${KID[k.status] ?? KID.KELUAR}`}><span className="w-1.5 h-1.5 rounded-full bg-current" />{k.name} · {k.branch}</span>)}{f.kids.length < f.studentCount && <span className="pill h-[30px] bg-n-50 text-n-600">+{f.studentCount - f.kids.length} di cabang lain</span>}</div>
            <span className="text-sm font-bold text-brand-700">Detail ›</span>
          </button>))}</div>}

      {sel && <Drawer open onClose={() => { setSel(null); setForm({}); }} title={`Kel. ${famName(sel)}`} sub={editing ? 'Ubah data keluarga' : 'Data keluarga'}
        footer={can(user, 'wali.edit') && d ? (editing ? <div className="flex gap-3"><button className="btn-secondary flex-1" onClick={() => setForm({})}>Batal</button><button className="btn-primary flex-[2]" onClick={save}>Simpan</button></div> : <button className="btn-primary w-full" onClick={edit}>Edit data keluarga</button>) : undefined}>
        {!d ? <div className="text-sm text-n-600">Memuat…</div> : editing ? <div className="space-y-4">{err && <Alert>{err}</Alert>}
          {F.map(([k, l]) => <Field key={k} label={l}><input className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>)}
          <Alert kind="info">Ubah no. WA cukup sekali; berlaku untuk semua anak di keluarga ini.</Alert></div>
          : <>
            <KV rows={F.filter(([k]) => d[k]).map(([k, l]) => [l, d[k] === 'Disembunyikan' ? <span className="text-n-500 font-normal">Disembunyikan</span> : d[k]] as [string, any])} />
            <div><div className="label">Santri di keluarga ini</div><div className="space-y-2">{d.students.map((s: any) => <Link key={s.id} to={`/santri/${s.id}`} className="card flex items-center gap-3 px-4 py-3"><Avatar name={s.fullName} size={36} /><div className="flex-1"><div className="font-semibold text-sm">{s.fullName}</div><div className="text-xs text-n-600">{s.nis}</div></div><Badge status={s.status} /></Link>)}</div></div>
            {can(user, 'spp.input') && <FamilySubsidy kids={d.students} onSaved={() => { qc.invalidateQueries({ queryKey: ['family', sel.id] }); qc.invalidateQueries({ queryKey: ['subsidies'] }); qc.invalidateQueries({ queryKey: ['student'] }); }} />}
            <Alert kind="info">Ubah no. WA cukup sekali; berlaku untuk semua anak di keluarga ini.</Alert>
          </>}
      </Drawer>}
    </div>
  );
}

/** Subsidi SPP per anak (PJ): Reguler ↔ Saudara ↔ kategori lain. Pasangan diskon saudara disesuaikan server (pasang → saudara Reguler ikut; cabut → yang tinggal sendiri ikut dicabut). */
function FamilySubsidy({ kids, onSaved }: { kids: any[]; onSaved: () => void }) {
  const toast = useToast();
  const subs = useQuery({ queryKey: ['subsidies'], queryFn: () => get('/subsidies') });
  const [busy, setBusy] = useState(false);
  const opts = (k: any) => (subs.data ?? []).map((x: any) => ({ ...x, rate: x.rates.find((r: any) => r.branchId === k.branchId && r.available) }))
    .filter((x: any) => (x.isActive && x.rate) || x.id === k.subsidyId);
  const change = async (k: any, v: string) => {
    setBusy(true);
    try {
      const r = await patch(`/students/${k.id}`, { subsidyId: v ? Number(v) : null });
      const extra = [r.saudaraIkut && `${r.saudaraIkut} saudara ikut diskon saudara`, r.subsidiDicabut && `diskon saudara dicabut untuk ${r.subsidiDicabut} santri`].filter(Boolean).join(' · ');
      toast(extra ? `Subsidi tersimpan · ${extra}` : 'Subsidi tersimpan'); onSaved();
    } catch (e: any) { toast(e.message, 'danger'); } finally { setBusy(false); }
  };
  const list = kids.filter((k) => k.status !== 'KELUAR');
  if (!list.length) return null;
  return (
    <div>
      <div className="label">Subsidi SPP (rahasia)</div>
      <div className="space-y-2">{list.map((k) => (
        <div key={k.id} className="p-3.5 rounded-2xl bg-n-50 space-y-2">
          <div className="flex items-center gap-2"><div className="flex-1 min-w-0"><div className="font-semibold text-sm truncate">{k.fullName}</div><div className="text-xs text-n-600">{k.branchName} · {rupiah(k.sppRate)}/bulan</div></div><Badge status={k.status} /></div>
          <select className="input" aria-label={`Subsidi ${k.fullName}`} value={k.subsidyId ?? ''} disabled={busy} onChange={(e) => change(k, e.target.value)}>
            <option value="">{!k.subsidyId && k.subsidyLabel ? `${k.subsidyLabel} (label lama)` : 'Reguler (tanpa subsidi)'}</option>
            {opts(k).map((x: any) => <option key={x.id} value={x.id}>{x.name}{x.rate ? ` · ${rupiah(x.rate.amount)}` : ''}</option>)}
          </select>
        </div>))}
      </div>
      <p className="text-xs text-n-600 mt-2">Berlaku mulai tagihan SPP berikutnya. Saudara: saudara Aktif yang masih Reguler ikut dipasang; bila dicabut (mis. saudaranya lulus) dan pemegangnya tinggal satu, diskon saudaranya ikut dicabut.</p>
    </div>
  );
}
