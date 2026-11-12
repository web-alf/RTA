import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, KeyRound, Laptop, MessageCircle, Smartphone } from 'lucide-react';
import { get, patch, post, tgl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { Alert, Avatar, Card, Dialog, Field, PageHeader, Toggle } from '../components/ui';

const ROLE: Record<string, string> = { PJ: 'PJ RTA', USTADZAH: 'Ustadzah', MANAJER: 'Manajer', WALI: 'Wali Santri' };
const device = (ua = '') => (/Android|iPhone|iPad|Mobile/i.test(ua) ? Smartphone : Laptop);
const deviceName = (ua = '') => {
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Perangkat';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} · ${os}`;
};

export default function Profil() {
  const { logout, user } = useAuth(); const nav = useNavigate(); const qc = useQueryClient(); const toast = useToast();
  const p = useQuery({ queryKey: ['profile'], queryFn: () => get('/auth/profile') });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => get('/auth/sessions') });
  const [form, setForm] = useState({ name: '', phone: '' }); const [err, setErr] = useState('');
  const [out, setOut] = useState(false); const [all, setAll] = useState(false);
  useEffect(() => { if (p.data) setForm({ name: p.data.name, phone: p.data.phone ?? '' }); }, [p.data]);
  const save = useMutation({ mutationFn: () => patch('/auth/profile', { name: form.name, phone: form.phone || undefined }), onSuccess: () => { toast('Profil tersimpan'); setErr(''); qc.invalidateQueries({ queryKey: ['profile'] }); }, onError: (e: any) => setErr(e.details?.join(', ') ?? e.message) });
  const pref = useMutation({ mutationFn: (b: any) => patch('/auth/prefs', b), onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }) });
  const revoke = useMutation({ mutationFn: (id: string) => post(`/auth/sessions/${id}/revoke`), onSuccess: () => { toast('Perangkat dikeluarkan'); qc.invalidateQueries({ queryKey: ['sessions'] }); } });
  const doLogout = async () => { if (all) await post('/auth/logout-all').catch(() => {}); await logout(); nav('/login'); };
  const d = p.data; const prefs = d?.prefs ?? {};
  if (!d) return <p className="text-sm text-n-600">Memuat…</p>;
  return (
    <div className="space-y-5">
      <PageHeader title="Profil & pengaturan" sub="Kelola data diri, keamanan akun, dan notifikasi" />
      <div className="grid lg:grid-cols-[320px_minmax(0,1fr)] gap-5 items-start">
        <section className="rounded-card p-6 bg-brand-50 flex flex-col items-center text-center gap-3">
          <Avatar name={d.name} size={96} square />
          <div><div className="font-display font-black text-xl">{d.name}</div><div className="text-sm text-n-700">{d.email}</div></div>
          <div className="flex flex-wrap justify-center gap-1.5"><span className="pill h-7 bg-white text-brand-800">{ROLE[d.role] ?? d.roleName}</span>{d.branches.map((b: any) => <span key={b.name} className="pill h-7 bg-white text-brand-800">Cabang {b.name}{b.endDate ? ` s/d ${tgl(b.endDate)}` : ''}</span>)}</div>
          <div className="grid grid-cols-2 gap-2 w-full mt-1"><div className="bg-white rounded-2xl p-3"><div className="num text-xl">{user?.role === 'USTADZAH' ? d.santriDiampu : '—'}</div><div className="text-xs text-n-600">santri diampu</div></div><div className="bg-white rounded-2xl p-3"><div className="num text-lg">{tgl(d.createdAt)}</div><div className="text-xs text-n-600">akun dibuat</div></div></div>
        </section>
        <div className="space-y-5">
          <Card title="Data diri"><div className="space-y-4">{err && <Alert>{err}</Alert>}
            <div className="grid sm:grid-cols-2 gap-4"><Field label="Nama"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="No. WA"><input className="input" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08…" /></Field></div>
            <Field label="Email (dipakai untuk masuk)" hint="Email, role, dan cabang hanya bisa diubah oleh PJ RTA."><input className="input !bg-n-50 !border-dashed text-n-600" value={d.email} readOnly /></Field>
            <div className="flex justify-end"><button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Simpan</button></div></div></Card>
          <Card title="Keamanan"><div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 p-3.5 rounded-2xl bg-n-50"><span className="w-10 h-10 rounded-xl bg-butter-bg text-butter-fg flex items-center justify-center"><KeyRound size={18} /></span><div className="flex-1 min-w-[160px]"><div className="font-semibold text-sm">Password</div><div className="text-xs text-n-600">{d.passwordChangedAt ? `Terakhir diganti ${tgl(d.passwordChangedAt)}` : 'Belum pernah diganti'}</div></div><Link to="/ganti-password" className="btn-secondary !h-9">Ganti password</Link></div>
            <div className="label !mb-0">Perangkat yang sedang masuk</div>
            {sessions.data?.map((s: any) => { const I = device(s.userAgent); return (
              <div key={s.id} className="flex items-center gap-3"><span className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.current ? 'bg-mint-bg text-mint-fg' : 'bg-n-50 text-brand-800'}`}><I size={18} /></span><div className="flex-1 min-w-0"><div className="font-semibold text-sm truncate">{deviceName(s.userAgent)}</div><div className="text-xs text-n-600">{s.ip || 'IP tidak diketahui'} · aktif {tgl(s.lastActive)}</div></div>
                {s.current ? <span className="text-xs font-bold text-mint-fg">Perangkat ini</span> : <button className="btn-text !h-9 !text-danger-fg" onClick={() => revoke.mutate(s.id)}>Keluarkan</button>}</div>); })}
          </div></Card>
          <Card title="Notifikasi & tampilan"><div className="space-y-4">
            {[['notifHafalan', 'Pengingat input hafalan', 'Setiap pekan, bila ada santri yang belum diinput'], ['notifBukti', 'Bukti pembayaran masuk', 'Saat wali mengunggah bukti transfer'], ['notifPengajuan', 'Hasil pengajuan', 'Saat PJ menyetujui atau menolak']].map(([k, l, s]) => (
              <div key={k} className="flex items-center gap-3"><div className="flex-1"><div className="font-semibold text-sm">{l}</div><div className="text-xs text-n-600">{s}</div></div><Toggle label={l} checked={prefs[k] !== false} onChange={(v) => pref.mutate({ [k]: v })} /></div>))}
            <div className="flex flex-wrap items-center gap-3"><div className="flex-1 min-w-[180px]"><div className="font-semibold text-sm">Ukuran teks</div><div className="text-xs text-n-600">Perbesar agar nyaman dibaca di HP</div></div>
              <div role="radiogroup" aria-label="Ukuran teks" className="inline-flex gap-1 p-1 rounded-full bg-n-50">{[['normal', 'Normal'], ['besar', 'Besar']].map(([v, l]) => <button key={v} role="radio" aria-checked={(prefs.textSize ?? 'normal') === v} onClick={() => pref.mutate({ textSize: v })} className={`h-9 px-4 rounded-full text-[13px] font-bold ${(prefs.textSize ?? 'normal') === v ? 'bg-brand-600 text-white' : 'text-brand-800'}`}>{l}</button>)}</div></div>
            <p className="text-xs text-n-600">Pengiriman notifikasi (WhatsApp/email) aktif di Fase 4; preferensi Anda sudah tersimpan.</p>
          </div></Card>
          <Card title="Bantuan"><div id="bantuan" className="grid sm:grid-cols-2 gap-3">
            <button type="button" onClick={() => toast('Panduan ada di docs/PANDUAN.md pada paket aplikasi')} className="flex items-center gap-3 p-3.5 rounded-2xl bg-n-50 text-left"><span className="w-10 h-10 rounded-xl bg-rose-bg text-rose-fg flex items-center justify-center"><BookOpen size={18} /></span><div><div className="font-semibold text-sm">Panduan pemakaian</div><div className="text-xs text-n-600">Langkah per menu</div></div></button>
            <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-n-50"><span className="w-10 h-10 rounded-xl bg-mint-bg text-mint-fg flex items-center justify-center"><MessageCircle size={18} /></span><div><div className="font-semibold text-sm">Hubungi PJ RTA</div><div className="text-xs text-n-600">Untuk reset password, buka kunci akun, atau ubah cabang</div></div></div>
          </div></Card>
          <section className="flex flex-wrap items-center gap-3 p-5 rounded-card bg-[#fdf5f4]">
            <div className="flex-1 min-w-[220px]"><div className="font-bold">Keluar</div><div className="text-[13px] text-n-700">Keluar dari perangkat ini, atau dari semua perangkat bila HP hilang.</div></div>
            <button className="btn-secondary !text-danger-fg" onClick={() => { setAll(true); setOut(true); }}>Keluar dari semua perangkat</button>
            <button className="btn-danger" onClick={() => { setAll(false); setOut(true); }}>Keluar</button>
          </section>
        </div>
      </div>
      <Dialog open={out} onClose={() => setOut(false)} title="Keluar dari akun?">
        <p className="text-sm text-n-700">Data yang belum disimpan akan hilang. Anda perlu masuk lagi dengan email dan password.</p>
        <label className="flex items-center gap-3 mt-4 p-3.5 rounded-2xl bg-white shadow-soft text-sm"><input type="checkbox" className="w-5 h-5 accent-brand-600" checked={all} onChange={(e) => setAll(e.target.checked)} />Keluar juga dari semua perangkat lain</label>
        <div className="flex gap-3 mt-5"><button className="btn-soft flex-1" onClick={() => setOut(false)}>Batal</button><button className="btn-danger flex-1" onClick={doLogout}>Ya, keluar</button></div>
      </Dialog>
    </div>
  );
}
