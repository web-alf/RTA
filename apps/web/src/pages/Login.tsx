import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Alert, Field, PasswordInput } from '../components/ui';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const u = await login(email, password);
      nav(u.mustChangePassword ? '/ganti-password' : '/');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-white">
      <section className="relative overflow-hidden bg-brand-50 px-6 py-8 md:p-14 flex flex-col justify-between gap-10 min-h-[220px]">
        <div aria-hidden className="absolute w-80 h-80 rounded-full bg-rose-bg -right-20 top-24" />
        <div aria-hidden className="absolute w-44 h-44 rounded-[48px] bg-butter-bg left-12 bottom-32 rotate-12 hidden md:block" />
        <div aria-hidden className="absolute w-28 h-28 rounded-full bg-lilac-bg right-32 bottom-12 hidden md:block" />
        <div aria-hidden className="absolute w-20 h-20 rounded-[26px] bg-mint-bg left-[45%] top-[38%] -rotate-12 hidden md:block" />
        <div className="relative flex items-center">
          <img src="/logo.png" alt="" className="h-12 w-auto shrink-0" />
          <span className="font-display font-black text-lg md:text-xl">Rumah Tahfidz Al-Fatihah</span>
        </div>
        <div className="relative max-w-md hidden md:block">
          <h1 className="font-display font-black text-[40px] leading-tight">Santri, hafalan, dan SPP dalam satu tempat.</h1>
          <p className="mt-3 text-n-700">Dashboard untuk PJ, ustadzah, dan manajer di empat cabang RTA.</p>
        </div>
      </section>
      <main className="flex items-start md:items-center justify-center px-6 py-10">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5">
          <div>
            <h2 className="font-display font-black text-3xl">Masuk</h2>
            <p className="text-sm text-n-600 mt-1">Assalamu'alaikum, silakan masuk dengan akun Anda.</p>
          </div>
          {err && <Alert>{err}</Alert>}
          <Field label="Email">
            <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <button className="btn-primary w-full !h-12" disabled={busy}>
            {busy ? 'Memeriksa…' : 'Masuk'}
          </button>
          <p className="text-xs text-n-600 text-center">Lupa password? Hubungi PJ RTA atau Admin Sistem.</p>
        </form>
      </main>
    </div>
  );
}
