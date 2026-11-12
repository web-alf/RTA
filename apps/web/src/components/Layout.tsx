import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, CalendarDays, ClipboardCheck, Contact, CreditCard, FileText, HelpCircle, Home, KeyRound, LogOut, MoreHorizontal, ReceiptText, ScrollText, Settings, ShieldCheck, TrendingUp, User, UserCog, Users, Wallet, UserPlus, Banknote } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { can, get } from '../lib/api';
import { Avatar } from './ui';

export const MENU = [
  { to: '/', label: 'Beranda', perm: 'dashboard.lihat', Icon: Home },
  { to: '/pendaftaran', label: 'Pendaftaran', perm: 'pendaftaran.lihat', Icon: UserPlus },
  { to: '/anak', label: 'Tagihan', perm: 'portal.lihat', Icon: ReceiptText },
  { to: '/perkembangan', label: 'Anak Saya', perm: 'portal.lihat', Icon: TrendingUp },
  { to: '/spp', label: 'SPP', perm: 'spp.lihat', Icon: CreditCard },
  { to: '/bayar', label: 'Bayar', perm: 'bayar.lihat', Icon: Wallet },
  { to: '/kas', label: 'Kas', perm: 'kas.lihat', Icon: Banknote },
  { to: '/lps', label: 'LPS', perm: 'lps.lihat', Icon: FileText },
  { to: '/kelas', label: 'Kelas', perm: 'kelas.lihat', Icon: BookOpen },
  { to: '/santri', label: 'Santri', perm: 'santri.lihat', Icon: Users },
  { to: '/ustadzah', label: 'Ustadzah', perm: 'ustadzah.lihat', Icon: UserCog },
  { to: '/wali', label: 'Wali', perm: 'wali.lihat', Icon: Contact },
  { to: '/pengajuan', label: 'Pengajuan', perm: 'pengajuan.lihat', Icon: ClipboardCheck },
  { to: '/agenda', label: 'Agenda', perm: 'agenda.lihat', Icon: CalendarDays },
  { to: '/role', label: 'Role', perm: 'role.lihat', Icon: ShieldCheck },
  { to: '/akun', label: 'Akun', perm: 'akun.lihat', Icon: KeyRound },
  { to: '/audit', label: 'Audit', perm: 'audit.lihat', Icon: ScrollText },
  { to: '/pengaturan', label: 'Pengaturan', perm: 'pengaturan.lihat', Icon: Settings },
];
const TAB_PREF = ['/', '/anak', '/perkembangan', '/santri', '/kelas', '/bayar', '/spp', '/lps', '/pengajuan', '/akun'];
const ROLE_LABEL: Record<string, string> = { PJ: 'PJ RTA', USTADZAH: 'Ustadzah', MANAJER: 'Manajer', WALI: 'Wali Santri' };

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  const items = MENU.filter((m) => can(user, m.perm));
  const tabs = TAB_PREF.map((t) => items.find((i) => i.to === t)).filter(Boolean).slice(0, 4) as typeof MENU;
  const rest = items.filter((i) => !tabs.includes(i));
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => get('/auth/profile') });
  const branch = profile.data?.branches?.map((b: any) => b.name).join(', ');

  useEffect(() => { document.documentElement.classList.toggle('text-besar', profile.data?.prefs?.textSize === 'besar'); }, [profile.data]);
  useEffect(() => { setMenu(false); setSheet(false); }, [loc.pathname]);
  useEffect(() => {
    const c = (e: MouseEvent) => { if (pop.current && !pop.current.contains(e.target as Node)) setMenu(false); };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && (setMenu(false), setSheet(false));
    document.addEventListener('mousedown', c); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', c); document.removeEventListener('keydown', k); };
  }, []);
  const doLogout = async () => { await logout(); nav('/login'); };
  const isActive = (to: string) => (to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to));

  return (
    <div className="min-h-screen flex bg-page">
      {/* Rail: berlabel di ≥1024px, ikon saja di 768–1023px */}
      <nav aria-label="Menu utama" className="hidden md:flex sticky top-0 h-screen flex-col items-center gap-1.5 py-5 bg-rail rounded-r-[32px] w-[72px] lg:w-24 shrink-0 z-30">
        <Link to="/" aria-label="Beranda" className="w-14 lg:w-20 mb-4 shrink-0 rounded-xl"><img src="/logo.png" alt="" className="w-full h-auto" /></Link>
        <div className="flex-1 w-full overflow-y-auto flex flex-col items-center gap-1.5">
          {items.map((m) => (
            <NavLink key={m.to} to={m.to} end={m.to === '/'} title={m.label} aria-label={m.label}
              className={({ isActive }) => `w-12 lg:w-[76px] py-2 rounded-[18px] flex flex-col items-center gap-1 text-[11px] transition ${isActive ? 'bg-brand-600 text-white font-semibold shadow-brand' : 'text-brand-800 hover:bg-white/70'}`}>
              <m.Icon size={20} aria-hidden /><span className="hidden lg:block">{m.label}</span>
            </NavLink>))}
        </div>
        <div ref={pop} className="relative mt-2">
          <button onClick={() => setMenu((v) => !v)} aria-label="Menu profil" aria-expanded={menu} className={`rounded-full ${menu ? 'ring-[3px] ring-brand-600' : 'shadow-soft'}`}><Avatar name={user?.name ?? ''} size={46} /></button>
          {menu && (
            <div role="menu" className="absolute left-[60px] lg:left-[72px] bottom-0 w-72 bg-white rounded-3xl shadow-float p-3 z-50">
              <div className="flex items-center gap-3 p-2.5 pb-3.5 mb-1.5 border-b border-n-100"><Avatar name={user?.name ?? ''} size={44} /><div className="min-w-0"><div className="font-bold truncate">{user?.name}</div><div className="text-xs text-n-600 truncate">{ROLE_LABEL[user?.role ?? ''] ?? user?.role}{branch ? ` · ${branch}` : ''}</div></div></div>
              {[{ to: '/profil', label: 'Profil & pengaturan', Icon: User, t: 'bg-rose-bg text-rose-fg' }, { to: '/ganti-password', label: 'Ganti password', Icon: KeyRound, t: 'bg-butter-bg text-butter-fg' }, { to: '/profil#bantuan', label: 'Bantuan & panduan', Icon: HelpCircle, t: 'bg-mint-bg text-mint-fg' }].map((m) => (
                <Link key={m.label} role="menuitem" to={m.to} className="flex items-center gap-3 p-2.5 rounded-2xl hover:bg-n-50 text-sm font-semibold"><span className={`w-9 h-9 rounded-xl flex items-center justify-center ${m.t}`}><m.Icon size={18} /></span>{m.label}</Link>))}
              <button role="menuitem" onClick={doLogout} className="w-full flex items-center gap-3 p-2.5 mt-1 border-t border-n-100 rounded-2xl hover:bg-danger-bg text-sm font-bold text-danger-fg"><span className="w-9 h-9 rounded-xl bg-danger-bg flex items-center justify-center"><LogOut size={18} /></span>Keluar</button>
            </div>)}
        </div>
      </nav>

      <div className="flex-1 min-w-0">
        <main className="max-w-[1320px] mx-auto px-4 md:px-8 pt-6 md:pt-8 pb-32 md:pb-10"><Outlet /></main>
      </div>

      {/* Tab bar bawah (< 768px) */}
      <nav aria-label="Navigasi utama" className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white rounded-t-3xl shadow-up flex justify-around px-2 pt-3 pb-[max(14px,env(safe-area-inset-bottom))]">
        {tabs.map((t) => { const on = isActive(t.to); return (
          <Link key={t.to} to={t.to} aria-current={on ? 'page' : undefined} className={`w-16 flex flex-col items-center gap-1 text-[11px] font-semibold ${on ? 'text-brand-700' : 'text-n-600'}`}>
            <span className={`w-[52px] h-8 rounded-full flex items-center justify-center ${on ? 'bg-brand-600 text-white' : ''}`}><t.Icon size={20} aria-hidden /></span>{t.label}</Link>); })}
        <button onClick={() => setSheet(true)} aria-expanded={sheet} className={`w-16 flex flex-col items-center gap-1 text-[11px] font-semibold ${sheet || rest.some((r) => isActive(r.to)) ? 'text-brand-700' : 'text-n-600'}`}>
          <span className={`w-[52px] h-8 rounded-full flex items-center justify-center ${rest.some((r) => isActive(r.to)) ? 'bg-brand-600 text-white' : ''}`}><MoreHorizontal size={20} aria-hidden /></span>Lainnya</button>
      </nav>
      {sheet && (
        <div className="md:hidden fixed inset-0 z-50 bg-[rgba(45,11,38,.45)]" onClick={() => setSheet(false)}>
          <section role="dialog" aria-label="Menu lainnya" onClick={(e) => e.stopPropagation()} className="absolute inset-x-0 bottom-0 bg-page rounded-t-[32px] px-5 pt-3 pb-[max(28px,env(safe-area-inset-bottom))] space-y-5 shadow-float max-h-[90vh] overflow-y-auto">
            <div className="mx-auto w-11 h-1.5 rounded-full bg-n-300" />
            <Link to="/profil" className="card flex items-center gap-3 p-4"><Avatar name={user?.name ?? ''} size={44} /><div className="flex-1 min-w-0"><div className="font-bold truncate">{user?.name}</div><div className="text-xs text-n-600">Lihat profil & pengaturan</div></div><span className="text-n-400 text-xl">›</span></Link>
            <div className="grid grid-cols-3 gap-3">
              {rest.map((m, i) => (
                <Link key={m.to} to={m.to} className="card flex flex-col items-center gap-2.5 py-4 px-2 text-xs font-semibold">
                  <span className={`w-10 h-10 rounded-[14px] flex items-center justify-center ${['bg-rose-bg text-rose-fg', 'bg-butter-bg text-butter-fg', 'bg-lilac-bg text-lilac-fg', 'bg-mint-bg text-mint-fg'][i % 4]}`}><m.Icon size={20} /></span>{m.label}</Link>))}
            </div>
            <button onClick={doLogout} className="btn w-full bg-danger-bg text-danger-fg">Keluar</button>
          </section>
        </div>)}
    </div>
  );
}
