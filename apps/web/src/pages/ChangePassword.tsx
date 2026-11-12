import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { post, setToken } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Field, PageHeader, PasswordInput } from '../components/ui';
import { useToast } from '../components/Toast';

export default function ChangePassword() {
  const { user, setUser } = useAuth(); const nav = useNavigate(); const toast = useToast();
  const [oldPassword, setOld] = useState(''); const [newPassword, setNew] = useState(''); const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    try { const r = await post('/auth/change-password', { oldPassword, newPassword }); setToken(r.accessToken); setUser(r.user); toast('Password diperbarui'); nav('/'); }
    catch (e: any) { setErr(e.details?.join(' ') ?? e.message); }
  };
  return (
    <div className="max-w-md">
      <PageHeader title="Ganti password" />
      {user?.mustChangePassword && <div className="mb-4"><Alert kind="warning">Ini login pertama Anda. Buat password baru sebelum melanjutkan.</Alert></div>}
      <form onSubmit={submit} className="panel p-5 space-y-4">
        {err && <Alert>{err}</Alert>}
        <Field label="Password lama"><PasswordInput autoComplete="current-password" value={oldPassword} onChange={(e) => setOld(e.target.value)} required /></Field>
        <Field label="Password baru" hint="Minimal 8 karakter, memuat huruf dan angka"><PasswordInput autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} required /></Field>
        <button className="btn-primary">Simpan password</button>
      </form>
    </div>
  );
}
