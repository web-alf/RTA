import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { can, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { Alert, Avatar, Field } from '../components/ui';
import { SubsidySelect } from '../components/SubsidySelect';
import { useToast } from '../components/Toast';

const STEPS = ['Keluarga', 'Identitas', 'Kelas', 'Status'];
const TIPS = [['Keluarga', 'No WA wali, nama & pekerjaan ayah/ibu, alamat'], ['Identitas', 'Nama, jenis kelamin, tempat & tanggal lahir'], ['Kelas', 'Hanya jenjang yang ada di cabang'], ['Status', 'Aktif atau Indent, keterangan pendaftaran']];
const TONE = ['bg-rose-bg text-rose-fg', 'bg-butter-bg text-butter-fg', 'bg-lilac-bg text-lilac-fg', 'bg-mint-bg text-mint-fg'];
const TITLE = ['Data keluarga', 'Identitas santri', 'Cabang & kelas', 'Status awal'];
const SUB = ['Cek nomor WhatsApp orang tua dulu. Kalau sudah terdaftar, data keluarga dipakai ulang untuk kakak-adik.', 'Data pribadi santri.', 'Kelas = cabang × jenjang; hanya jenjang yang tersedia di cabang itu.', 'ID santri dibuat otomatis saat disimpan.'];
export default function SantriBaru() {
  const nav = useNavigate(); const toast = useToast(); const { user } = useAuth();
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => get('/branches') });
  const [step, setStep] = useState(0); const [err, setErr] = useState('');
  const [phone, setPhone] = useState(''); const [lookup, setLookup] = useState<any>(null);
  const [fam, setFam] = useState<any>({ fatherName: '', motherName: '', guardianName: '', guardianRelation: '', backupPhone: '', address: '', fatherJob: '', motherJob: '' });
  const [s, setS] = useState<any>({ fullName: '', nickname: '', gender: 'P', birthPlace: '', birthDate: '', school: '', branchId: '', classId: '', joinDate: new Date().toISOString().slice(0, 10), status: 'AKTIF', healthNotes: '', registrationNote: '', subsidyId: '' });
  const f = (k: string) => ({ value: s[k], onChange: (e: any) => setS({ ...s, [k]: e.target.value }) });
  const fm = (k: string) => ({ value: fam[k], onChange: (e: any) => setFam({ ...fam, [k]: e.target.value }) });
  const cek = async () => { setErr(''); try { setLookup(await get(`/families/lookup?phone=${encodeURIComponent(phone)}`)); } catch (e: any) { setErr(e.message); } };
  const branch = branches.data?.find((b: any) => b.id === Number(s.branchId));
  const next = () => {
    setErr('');
    if (step === 0 && !lookup) return setErr('Cek nomor WA dulu.');
    if (step === 0 && lookup?.found && !lookup.inScope) return setErr(lookup.message);
    if (step === 0 && !lookup?.found && (!fam.fatherName || !fam.motherName || !fam.address)) return setErr('Nama ayah, nama ibu, dan alamat wajib diisi.');
    if (step === 1 && (!s.fullName || !s.birthPlace || !s.birthDate)) return setErr('Nama, tempat, dan tanggal lahir wajib diisi.');
    if (step === 2 && (!s.branchId || !s.classId || !s.joinDate)) return setErr('Cabang, jenjang, dan tanggal bergabung wajib diisi.');
    setStep(step + 1);
  };
  const submit = async () => {
    setErr('');
    const body: any = { ...s, branchId: Number(s.branchId), classId: Number(s.classId), subsidyId: s.subsidyId ? Number(s.subsidyId) : '' };
    for (const k of Object.keys(body)) if (body[k] === '') delete body[k];
    if (lookup?.found) body.familyId = lookup.family.id; else { body.family = { ...fam, waPhone: phone }; for (const k of Object.keys(body.family)) if (body.family[k] === '') delete body.family[k]; }
    try { const r = await post('/students', body); toast(`Tersimpan. ID santri ${r.nis}${r.saudaraIkut ? ` · ${r.saudaraIkut} saudara ikut diskon saudara` : ''}`); nav(`/santri/${r.id}`); } catch (e: any) { setErr(e.details?.join(', ') ?? e.message); }
  };
  return (
    <div>
      <Link to="/santri" className="text-sm font-semibold">‹ Kembali ke daftar santri</Link>
      <h1 className="h1 mt-2 mb-5">Tambah santri</h1>
      <ol aria-label="Langkah" className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-2 md:mx-0 md:px-0 mb-5">{STEPS.map((t, i) => (
        <li key={t} aria-current={i === step ? 'step' : undefined} className={`shrink-0 flex items-center gap-2.5 pl-2 pr-4 py-2 rounded-full ${i === step ? 'bg-brand-100 text-brand-800' : i < step ? 'bg-mint-bg text-mint-fg' : 'bg-n-50 text-n-600'}`}>
          <span className={`w-[30px] h-[30px] rounded-full flex items-center justify-center font-display font-black text-sm ${i === step ? 'bg-brand-600 text-white' : i < step ? 'bg-white text-mint-fg' : 'bg-white text-n-600'}`}>{i < step ? '✓' : i + 1}</span><span className="text-sm font-semibold">{t}</span></li>))}</ol>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
      <div>
      <div className="card p-5 md:p-7 space-y-5">
        <div><h2 className="font-display font-extrabold text-xl">{TITLE[step]}</h2><p className="text-sm text-n-600 mt-1">{SUB[step]}</p></div>
        {err && <Alert>{err}</Alert>}
        {step === 0 && <>
          <Field label="No WA wali" hint="Cek dulu: bila sudah terdaftar, data keluarga dipakai ulang (hindari duplikat).">
            <div className="flex gap-2"><input className="input" placeholder="08xxxxxxxxxx" value={phone} onChange={(e) => { setPhone(e.target.value); setLookup(null); }} /><button className="btn-secondary shrink-0" onClick={cek} disabled={!phone}>Cek</button></div></Field>
          {lookup && (lookup.found ? (lookup.inScope
            ? <div className="flex flex-wrap items-center gap-3 p-4 rounded-2xl bg-mint-bg text-mint-fg"><span className="w-11 h-11 rounded-2xl bg-white flex items-center justify-center"><CheckCircle2 size={22} /></span><div className="flex-1 min-w-[200px]"><div className="font-bold">Keluarga ditemukan</div><div className="text-sm">{lookup.family.fatherName} & {lookup.family.motherName}{lookup.family.students?.length ? ` · ${lookup.family.students.length} santri terdaftar` : ''}</div></div><span className="pill bg-white text-mint-fg">Dipakai ulang</span></div>
            : <Alert kind="warning">{lookup.message}</Alert>)
            : <Alert kind="info">Nomor belum terdaftar. Isi data keluarga baru di bawah.</Alert>)}
          {lookup?.found && lookup.inScope && lookup.family.students?.length > 0 && <div className="grid sm:grid-cols-2 gap-3">{lookup.family.students.map((k: any) => <div key={k.id} className="flex items-center gap-3 p-3.5 rounded-2xl bg-n-50"><Avatar name={k.fullName} /><div><div className="font-semibold text-sm">{k.fullName}</div><div className="text-xs text-n-600">{k.className ?? k.branchName ?? ''}{k.status ? ` · ${k.status[0] + k.status.slice(1).toLowerCase()}` : ''}</div></div></div>)}</div>}
          {lookup && !lookup.found && <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Nama ayah"><input className="input" {...fm('fatherName')} /></Field><Field label="Nama ibu"><input className="input" {...fm('motherName')} /></Field>
            <Field label="Nama wali (jika bukan orang tua)"><input className="input" {...fm('guardianName')} /></Field><Field label="Hubungan wali"><input className="input" {...fm('guardianRelation')} placeholder="mis. nenek" /></Field>
            <Field label="No. HP cadangan"><input className="input" {...fm('backupPhone')} /></Field><div className="sm:col-span-2"><Field label="Alamat rumah"><input className="input" {...fm('address')} /></Field></div>
            <Field label="Pekerjaan ayah"><input className="input" {...fm('fatherJob')} /></Field><Field label="Pekerjaan ibu"><input className="input" {...fm('motherJob')} /></Field></div>}
        </>}
        {step === 1 && <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2"><Field label="Nama lengkap"><input className="input" {...f('fullName')} /></Field></div>
          <Field label="Nama panggilan"><input className="input" {...f('nickname')} /></Field>
          <Field label="Jenis kelamin"><select className="input" {...f('gender')}><option value="P">Perempuan</option><option value="L">Laki-laki</option></select></Field>
          <Field label="Tempat lahir"><input className="input" {...f('birthPlace')} /></Field><Field label="Tanggal lahir"><input className="input" type="date" {...f('birthDate')} /></Field>
          <div className="sm:col-span-2"><Field label="Sekolah formal dan kelas"><input className="input" {...f('school')} placeholder="mis. SDN 1 Semarang, kelas 3" /></Field></div>
        </div>}
        {step === 2 && <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Cabang"><select className="input" value={s.branchId} onChange={(e) => setS({ ...s, branchId: e.target.value, classId: '' })}><option value="">Pilih cabang</option>{branches.data?.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Jenjang (kelas)" hint="Hanya jenjang yang tersedia di cabang ini"><select className="input" {...f('classId')} disabled={!branch}><option value="">Pilih kelas</option>{branch?.classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Tanggal bergabung"><input className="input" type="date" {...f('joinDate')} /></Field>
        </div>}
        {step === 3 && <div className="space-y-4">
          <Field label="Status awal"><select className="input" {...f('status')}><option value="AKTIF">Aktif (sudah mulai belajar)</option><option value="INDENT">Indent (terdaftar, belum mulai)</option></select></Field>
          <Field label="Keterangan pendaftaran (opsional)" hint="mis. daftar lewat WhatsApp, pindahan dari TPQ lain"><input className="input" {...f('registrationNote')} /></Field>
          {can(user, 'spp.input') && <SubsidySelect branchId={branch?.id} value={s.subsidyId} onChange={(v) => setS({ ...s, subsidyId: v })} />}
          <Field label="Catatan kesehatan / alergi (opsional)"><input className="input" {...f('healthNotes')} /></Field>
          <div className="text-sm text-n-600">ID santri dibuat otomatis. Tarif SPP cabang ({branch?.name}) disimpan sebagai acuan santri ini, atau tarif subsidi bila kategori dipilih.</div>
        </div>}
      </div>
      <div className="flex justify-between gap-3 mt-4">
        <button className="btn-text" onClick={() => (step ? setStep(step - 1) : nav('/santri'))}>{step ? '‹ Kembali' : 'Batal'}</button>
        {step < 3 ? <button className="btn-primary" onClick={next}>Lanjut ke {STEPS[step + 1].toLowerCase()} ›</button> : <button className="btn-primary" onClick={submit}>Simpan santri</button>}
      </div>
      </div>
      <aside className="space-y-3">
        <h2 className="h2">Yang perlu disiapkan</h2>
        {TIPS.map(([t, d], i) => <div key={t} className={`card p-3.5 flex gap-3 ${i === step ? 'ring-2 ring-brand-200' : ''}`}><span className={`w-9 h-9 rounded-xl flex items-center justify-center font-display font-black shrink-0 ${TONE[i]}`}>{i + 1}</span><div><div className="font-semibold text-sm">{t}</div><div className="text-xs text-n-600">{d}</div></div></div>)}
        <div className="p-4 rounded-2xl bg-butter-bg text-butter-fg text-[13px]">ID santri dibuat otomatis. Tarif SPP cabang disimpan sebagai acuan santri ini.</div>
      </aside>
      </div>
    </div>
  );
}
