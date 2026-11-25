import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { KeyRound, LockOpen, Plus, RotateCcw, Trash2, UserCheck, UserX } from 'lucide-react';
import { can, get, patch, post, tgl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Dialog, Field, PageHeader, PasswordInput, SearchBox, Segmented } from '../components/ui';
import { Avatar } from '../components/ui';
import { useToast } from '../components/Toast';

export default function Akun() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['users'], queryFn: () => get('/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get('/roles') });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => get('/branches') });
  const EMPTY = { name: '', email: '', phone: '', password: '', roleCode: 'USTADZAH', familyId: 0, familyName: '', branchIds: [] as number[] };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [err, setErr] = useState('');
  const [famQ, setFamQ] = useState('');
  const fams = useQuery({ queryKey: ['families', famQ], queryFn: () => get(`/families?q=${encodeURIComponent(famQ)}`), enabled: form.roleCode === 'WALI' && famQ.trim().length >= 2 });
  const [temp, setTemp] = useState('');
  const [del, setDel] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [delErr, setDelErr] = useState('');
  const isPj = user?.role === 'PJ';
  // tab: halaman utama hanya akun aktif; nonaktif & daftar hapus dipisah
  const [tab, setTab] = useState<'aktif' | 'nonaktif' | 'hapus'>('aktif');
  const all: any[] = list.data ?? [];
  const tabOf = (u: any) => (u.deleteAfter ? 'hapus' : u.isActive ? 'aktif' : 'nonaktif');
  const count = (t: string) => all.filter((u) => tabOf(u) === t).length;
  const rows = all.filter((u) => tabOf(u) === tab);
  const EMPTY_TEXT = { aktif: 'Belum ada akun aktif.', nonaktif: 'Tidak ada akun nonaktif.', hapus: 'Daftar hapus kosong.' };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['users'] });
    qc.invalidateQueries({ queryKey: ['ustadzah'] });
  };
  const toggleBranch = (id: number) => setForm({ ...form, branchIds: form.branchIds.includes(id) ? form.branchIds.filter((b) => b !== id) : [...form.branchIds, id] });
  const create = async () => {
    setErr('');
    try {
      const { familyName, familyId, branchIds, ...body } = form;
      await post('/users', {
        ...body,
        phone: form.phone || undefined,
        familyId: form.roleCode === 'WALI' ? familyId || undefined : undefined,
        branchIds: form.roleCode === 'USTADZAH' ? branchIds : undefined,
      });
      toast('Akun dibuat. Minta pemilik akun ganti password saat login pertama.');
      setOpen(false);
      setTemp(form.password);
      setForm(EMPTY);
      setFamQ('');
      refresh();
    } catch (e: any) {
      setErr(e.details?.join(', ') ?? e.message);
    }
  };
  const act = async (u: any, what: string) => {
    try {
      if (what === 'toggle') {
        await patch(`/users/${u.id}`, { isActive: !u.isActive });
        toast(u.isActive ? 'Akun dinonaktifkan' : 'Akun diaktifkan');
      }
      if (what === 'reset') {
        if (!confirm(`Reset password ${u.name}?`)) return;
        const r = await post(`/users/${u.id}/reset-password`);
        setTemp(r.temporaryPassword);
      }
      if (what === 'unlock') {
        await post(`/users/${u.id}/unlock`);
        toast('Kunci login dibuka');
      }
      if (what === 'cancelDelete') {
        if (!confirm(`Batalkan penghapusan akun ${u.name}? Akun akan aktif kembali.`)) return;
        await post(`/users/${u.id}/batal-hapus`);
        toast('Penghapusan dibatalkan, akun aktif kembali');
      }
      refresh();
    } catch (e: any) {
      toast(e.message, 'danger');
    }
  };
  const requestDelete = async () => {
    setDelErr('');
    try {
      const r = await post(`/users/${del.id}/hapus`, { reason });
      toast(`Akun masuk daftar hapus. Dihapus permanen ${tgl(r.deleteAfter)}.`);
      setDel(null);
      setReason('');
      refresh();
    } catch (e: any) {
      setDelErr(e.details?.join(', ') ?? e.message);
    }
  };
  const branchText = (u: any) => (u.roleCode === 'USTADZAH' ? (u.branches.length ? u.branches.map((b: any) => b.branchName).join(', ') : 'Belum ada cabang') : '');
  const locked = (u: any) => u.lockedUntil && new Date(u.lockedUntil) > new Date();
  const StatusPill = ({ u }: { u: any }) =>
    u.deleteAfter ? (
      <span className="pill bg-danger-bg text-danger-fg">Dihapus {tgl(u.deleteAfter)}</span>
    ) : !u.isActive ? (
      <span className="pill bg-n-100 text-n-700">Nonaktif</span>
    ) : locked(u) ? (
      <span className="pill bg-danger-bg text-danger-fg">Terkunci</span>
    ) : u.mustChangePassword ? (
      <span className="pill bg-butter-bg text-butter-fg">Belum ganti password</span>
    ) : (
      <span className="pill bg-success-bg text-success-fg">Aktif</span>
    );
  const btn = (mobile?: boolean) => (mobile ? 'btn-soft !h-11 flex-1' : 'btn-text !h-8');
  const Actions = ({ u, mobile }: { u: any; mobile?: boolean }) =>
    !can(user, 'akun.edit') || u.id === user?.id ? null : u.deleteAfter ? (
      isPj ? (
        <div className={`flex flex-wrap gap-2 ${mobile ? '' : 'justify-end'}`}>
          <button className={`${btn(mobile)} !text-success-fg`} onClick={() => act(u, 'cancelDelete')}>
            <RotateCcw size={16} aria-hidden /> Batalkan hapus
          </button>
        </div>
      ) : null
    ) : (
      <div className={`flex flex-wrap gap-2 ${mobile ? '' : 'justify-end'}`}>
        {locked(u) && (
          <button className={btn(mobile)} onClick={() => act(u, 'unlock')}>
            <LockOpen size={16} aria-hidden /> Buka kunci
          </button>
        )}
        <button className={btn(mobile)} onClick={() => act(u, 'reset')}>
          <KeyRound size={16} aria-hidden /> Reset password
        </button>
        <button className={`${btn(mobile)} ${u.isActive ? '!text-warning-fg' : '!text-success-fg'}`} onClick={() => act(u, 'toggle')}>
          {u.isActive ? <UserX size={16} aria-hidden /> : <UserCheck size={16} aria-hidden />} {u.isActive ? 'Nonaktifkan' : 'Aktifkan'}
        </button>
        {isPj && (
          <button
            className={`${btn(mobile)} !text-danger-fg`}
            onClick={() => {
              setDel(u);
              setReason('');
              setDelErr('');
            }}
          >
            <Trash2 size={16} aria-hidden /> Hapus
          </button>
        )}
      </div>
    );
  const registerForm = (
    <div className="space-y-4">
      {err && <Alert>{err}</Alert>}
      <Field label="Nama">
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nama lengkap" />
      </Field>
      <Field label="Email">
        <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="nama@rta.local" />
      </Field>
      <Field label="No. WA (opsional)">
        <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08…" />
      </Field>
      <Field label="Password awal" hint="Min. 8 karakter, huruf & angka. Wajib diganti saat login pertama.">
        <PasswordInput autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      </Field>
      <div>
        <span className="label">Role</span>
        <div role="radiogroup" className="flex flex-wrap gap-1.5">
          {roles.data?.roles.map((r: any) => (
            <button
              key={r.code}
              type="button"
              role="radio"
              aria-checked={form.roleCode === r.code}
              onClick={() => setForm({ ...form, roleCode: r.code })}
              className={form.roleCode === r.code ? 'chip-on !h-9' : 'chip-off !h-9 !shadow-none bg-n-50'}
            >
              {r.name}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-n-600">Ustadzah hanya melihat santri di cabang yang dipilih. Akun wali hanya bisa melihat tagihan & LPS terbit anak di keluarganya.</p>
      </div>
      {form.roleCode === 'USTADZAH' && (
        <div>
          <span className="label">Cabang</span>
          <div role="group" aria-label="Cabang ustadzah" className="flex flex-wrap gap-1.5">
            {branches.data?.map((b: any) => (
              <button
                key={b.id}
                type="button"
                aria-pressed={form.branchIds.includes(b.id)}
                onClick={() => toggleBranch(b.id)}
                className={form.branchIds.includes(b.id) ? 'chip-on !h-11' : 'chip-off !h-11 !shadow-none bg-n-50'}
              >
                {b.name}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-n-600">Boleh lebih dari satu. Penugasan pengganti (dengan tanggal berakhir) diatur di menu Ustadzah.</p>
        </div>
      )}
      {form.roleCode === 'WALI' && (
        <Field label="Keluarga" hint="Cari nama ayah/ibu atau no. WA, lalu pilih satu keluarga.">
          {form.familyId ? (
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-mint-bg text-mint-fg text-sm">
              <b className="flex-1">Kel. {form.familyName}</b>
              <button type="button" className="btn-text !h-11" onClick={() => setForm({ ...form, familyId: 0, familyName: '' })}>
                Ganti
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <SearchBox value={famQ} onChange={setFamQ} placeholder="Cari keluarga" />
              {fams.data?.length === 0 && <p className="text-xs text-n-600">Keluarga tidak ditemukan.</p>}
              {fams.data?.slice(0, 6).map((f: any) => (
                <button
                  key={f.id}
                  type="button"
                  className="w-full text-left p-3 rounded-2xl bg-n-50 hover:bg-n-100 min-h-[44px]"
                  onClick={() => setForm({ ...form, familyId: f.id, familyName: f.fatherName || f.motherName || '', name: form.name || f.fatherName || f.motherName || '' })}
                >
                  <div className="font-semibold text-sm">
                    {[f.fatherName, f.motherName].filter(Boolean).join(' & ') || 'Nama orang tua belum diisi'}
                  </div>
                  <div className="text-xs text-n-600">{f.kids.map((k: any) => `${k.name} (${k.branch})`).join(', ') || 'Belum ada santri'}</div>
                </button>
              ))}
            </div>
          )}
        </Field>
      )}
      <button className="btn-primary w-full" onClick={create}>
        Simpan akun
      </button>
    </div>
  );
  return (
    <div className="space-y-5">
      <PageHeader
        title="Akun"
        sub="Satu akun per orang. Reset password, buka kunci, atau nonaktifkan di sini."
        actions={
          can(user, 'akun.input') && (
            <button
              className="btn-primary lg:hidden"
              onClick={() => {
                setOpen(true);
                setErr('');
              }}
            >
              <Plus size={16} /> Register akun
            </button>
          )
        }
      />
      {temp && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 rounded-2xl bg-butter-bg text-butter-fg text-sm">
          <b>
            Password sementara: <span className="font-mono">{temp}</span>
          </b>
          <span className="flex-1 min-w-[200px]">Sampaikan ke pemilik akun secara pribadi; wajib diganti saat login.</span>
          <button aria-label="Tutup" className="text-lg" onClick={() => setTemp('')}>
            ×
          </button>
        </div>
      )}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        <div className="space-y-4">
          <Segmented
            label="Status akun"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'aktif', label: `Aktif · ${count('aktif')}` },
              { value: 'nonaktif', label: `Nonaktif · ${count('nonaktif')}` },
              { value: 'hapus', label: `Daftar hapus · ${count('hapus')}` },
            ]}
          />
          {tab === 'hapus' && rows.length > 0 && <Alert kind="info">Akun di sini dihapus permanen pada tanggal yang tertera. Sebelum itu, PJ RTA masih bisa membatalkannya.</Alert>}
          {list.isSuccess && !rows.length && <div className="card p-8 text-center text-sm text-n-600">{EMPTY_TEXT[tab]}</div>}
          <div className="md:hidden space-y-3">
            {rows.map((u: any) => (
              <div key={u.id} className="card p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Avatar name={u.name} />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">{u.name}</div>
                    <div className="text-xs text-n-600 truncate">{u.email}</div>
                  </div>
                  <StatusPill u={u} />
                </div>
                <div className="text-xs text-n-600">
                  {u.roleName}
                  {u.familyName ? ` · Kel. ${u.familyName}` : ''}
                  {branchText(u) ? ` · ${branchText(u)}` : ''} · dibuat {tgl(u.createdAt)}
                </div>
                {u.deleteReason && <div className="text-xs text-danger-fg">Alasan hapus: {u.deleteReason}</div>}
                <Actions u={u} mobile />
              </div>
            ))}
          </div>
          <div className={`${rows.length ? 'md:block' : ''} hidden card overflow-x-auto`}>
            <table className="w-full min-w-[640px]">
              <thead>
                <tr>
                  <th className="th pl-5 pt-4">Nama</th>
                  <th className="th pt-4">Role</th>
                  <th className="th pt-4">Status</th>
                  <th className="th pt-4 pr-5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((u: any) => (
                  <tr key={u.id}>
                    <td className="td pl-5">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} />
                        <div>
                          <div className="font-semibold">{u.name}</div>
                          <div className="text-xs text-n-600">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="td">
                      {u.roleName}
                      {u.familyName && <div className="text-xs text-n-600">Kel. {u.familyName}</div>}
                      {branchText(u) && <div className="text-xs text-n-600">{branchText(u)}</div>}
                    </td>
                    <td className="td">
                      <StatusPill u={u} />
                      {u.deleteReason && <div className="mt-1 text-xs text-n-600 max-w-[220px]">{u.deleteReason}</div>}
                    </td>
                    <td className="td pr-5">
                      <Actions u={u} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {can(user, 'akun.input') && (
          <aside className="hidden lg:block sticky top-8">
            <h2 className="h2 mb-3">Register akun</h2>
            <div className="card p-5">{registerForm}</div>
          </aside>
        )}
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="Register akun">
        {registerForm}
      </Dialog>
      <Dialog open={!!del} onClose={() => setDel(null)} title={`Hapus akun ${del?.name ?? ''}`}>
        <div className="space-y-4">
          {delErr && <Alert>{delErr}</Alert>}
          <Alert kind="warning">
            Akun langsung nonaktif dan masuk daftar hapus. Setelah 30 hari, email, no. WA, password, dan penugasan cabang dihapus permanen. Selama 30 hari itu
            penghapusan masih bisa dibatalkan.
          </Alert>
          <p className="text-sm text-n-700">
            Data yang pernah diinput (hafalan, pembayaran, LPS, pengajuan) <b>tidak ikut terhapus</b> dan tetap tercatat atas nama <b>{del?.name}</b>.
          </p>
          <Field label="Alasan hapus">
            <textarea className="input !h-24 py-3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mis. sudah tidak mengajar sejak Oktober 2026" />
          </Field>
          <div className="flex gap-3">
            <button className="btn-secondary flex-1" onClick={() => setDel(null)}>
              Batal
            </button>
            <button className="btn-danger flex-1" disabled={reason.trim().length < 3} onClick={requestDelete}>
              Hapus akun
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
