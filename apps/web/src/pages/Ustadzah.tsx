import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { UserCog } from 'lucide-react';
import { can, del, get, post, tgl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Avatar, Chips, Dialog, Empty, Field, PageHeader } from '../components/ui';
import { useToast } from '../components/Toast';

export default function Ustadzah() {
  const { user } = useAuth(); const toast = useToast(); const qc = useQueryClient();
  const list = useQuery({ queryKey: ['ustadzah'], queryFn: () => get('/users/ustadzah') });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => get('/branches') });
  const [filter, setFilter] = useState('');
  const [sel, setSel] = useState<any>(null); const [form, setForm] = useState({ branchId: '', startDate: new Date().toISOString().slice(0, 10), endDate: '' }); const [err, setErr] = useState('');
  const add = async () => { setErr(''); try { await post(`/users/${sel.id}/branches`, { branchId: Number(form.branchId), startDate: form.startDate, endDate: form.endDate || undefined }); toast('Penugasan ditambahkan'); qc.invalidateQueries({ queryKey: ['ustadzah'] }); setSel(null); } catch (e: any) { setErr(e.details?.join(', ') ?? e.message); } };
  const remove = async (u: any, ubId: number) => { if (!confirm('Hapus penugasan ini?')) return; await del(`/users/${u.id}/branches/${ubId}`); toast('Penugasan dihapus'); qc.invalidateQueries({ queryKey: ['ustadzah'] }); };
  const today = new Date().toISOString().slice(0, 10);
  const rows = (list.data ?? []).filter((u: any) => !filter || u.branches.some((b: any) => String(b.branchId) === filter));
  const status = (u: any) => (!u.isActive ? ['Nonaktif', 'bg-n-100 text-n-700'] : !u.branches.length ? ['Belum ditugaskan', 'bg-danger-bg text-danger-fg'] : u.branches.every((b: any) => b.endDate) ? ['Pengganti', 'bg-butter-bg text-butter-fg'] : ['Aktif', 'bg-mint-bg text-mint-fg']);
  return (
    <div className="space-y-5">
      <PageHeader title="Ustadzah" sub={`${rows.length} ustadzah · penugasan cabang menentukan data yang bisa dilihat`}
        actions={can(user, 'akun.input') && <Link to="/akun" className="btn-primary">+ Tambah ustadzah</Link>} />
      <Chips label="Filter cabang" value={filter} onChange={setFilter} items={[{ value: '', label: 'Semua' }, ...(branches.data ?? []).map((b: any) => ({ value: String(b.id), label: b.name }))]} />
      {list.data && !rows.length ? <Empty icon={UserCog} text="Belum ada ustadzah." /> :
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{rows.map((u: any) => { const [st, cls] = status(u); return (
          <article key={u.id} className="card p-5 flex flex-col gap-4">
            <div className="flex items-center gap-3"><Avatar name={u.name} size={52} square /><div className="flex-1 min-w-0"><div className="font-display font-extrabold truncate">{u.name}</div><div className="text-xs text-n-600 truncate">{u.email}</div></div><span className={`pill ${cls}`}>{st}</span></div>
            <div className="flex flex-wrap gap-1.5 min-h-[30px]">{u.branches.map((b: any) => (
              <span key={b.id} className={`inline-flex items-center gap-1.5 h-[30px] pl-3 pr-2 rounded-full bg-n-50 text-xs ${b.endDate && b.endDate < today ? 'opacity-60 line-through' : ''}`}><b>{b.branchName}</b>{b.endDate ? <span className="text-n-600">s/d {tgl(b.endDate)}</span> : <span className="text-n-600">sejak {tgl(b.startDate)}</span>}
                {can(user, 'ustadzah.edit') && <button aria-label={`Hapus penugasan ${b.branchName}`} onClick={() => remove(u, b.id)} className="w-5 h-5 rounded-full hover:bg-danger-bg text-n-500 hover:text-danger-fg">×</button>}</span>))}
              {!u.branches.length && <span className="text-xs text-n-600 self-center">Belum ada cabang</span>}</div>
            <div className="flex items-center justify-between text-sm"><span className="text-n-700">{u.branches.length} cabang</span>{can(user, 'ustadzah.edit') && <button className="font-bold text-brand-700" onClick={() => { setSel(u); setErr(''); }}>+ Cabang</button>}</div>
          </article>); })}</div>}
      <Dialog open={!!sel} onClose={() => setSel(null)} title={`Tugaskan ${sel?.name ?? ''}`}>
        <div className="space-y-4">{err && <Alert>{err}</Alert>}
          <Field label="Cabang"><select className="input" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}><option value="">Pilih cabang</option>{branches.data?.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Tanggal mulai"><input className="input" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
          <Field label="Tanggal berakhir" hint="Isi hanya untuk pengganti; akses tertutup otomatis setelah tanggal ini."><input className="input" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
          <div className="flex gap-3"><button className="btn-soft flex-1" onClick={() => setSel(null)}>Batal</button><button className="btn-primary flex-1" onClick={add} disabled={!form.branchId}>Simpan</button></div></div></Dialog>
    </div>
  );
}
