import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import './index.css';
import { AuthProvider, useAuth } from './lib/auth';
import { ToastProvider } from './components/Toast';
import Layout from './components/Layout';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Dashboard from './pages/Dashboard';
import Santri from './pages/Santri';
import SantriBaru from './pages/SantriBaru';
import SantriDetail from './pages/SantriDetail';
import Pengajuan from './pages/Pengajuan';
import Wali from './pages/Wali';
import Ustadzah from './pages/Ustadzah';
import Akun from './pages/Akun';
import Role from './pages/Role';
import { Audit } from './pages/Misc';
import Kelas from './pages/Kelas';
import Spp from './pages/Spp';
import Bayar from './pages/Bayar';
import Lps from './pages/Lps';
import Profil from './pages/Profil';
import BayarWali from './pages/BayarWali';
import LaporanWali from './pages/LaporanWali';
import Anak from './pages/Anak';
import Perkembangan from './pages/Perkembangan';
import Pengaturan from './pages/Pengaturan';
import Agenda from './pages/Agenda';
import Kas from './pages/Kas';
import Pendaftaran from './pages/Pendaftaran';
import Absensi from './pages/Absensi';
import { can } from './lib/api';
import { MENU } from './components/Layout';

const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 } } });

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-n-600">Memuat…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword && location.pathname !== '/ganti-password') return <Navigate to="/ganti-password" replace />;
  return <Outlet />;
}
/** Beranda staf = dashboard; akun tanpa dashboard (wali) diarahkan ke menu pertama yang boleh dibuka. */
function Home() {
  const { user } = useAuth();
  if (can(user, 'dashboard.lihat')) return <Dashboard />;
  const first = MENU.find((m) => m.to !== '/' && can(user, m.perm));
  return first ? <Navigate to={first.to} replace /> : <p className="text-sm text-n-600">Akun ini belum punya akses menu. Silakan hubungi PJ RTA.</p>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}><ToastProvider><AuthProvider><BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/bayar/:token" element={<BayarWali />} />
        <Route path="/laporan/:token" element={<LaporanWali />} />
        <Route element={<Protected />}>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="anak" element={<Anak />} />
            <Route path="perkembangan" element={<Perkembangan />} />
            <Route path="ganti-password" element={<ChangePassword />} />
            <Route path="santri" element={<Santri />} />
            <Route path="santri/baru" element={<SantriBaru />} />
            <Route path="santri/:id" element={<SantriDetail />} />
            <Route path="wali" element={<Wali />} />
            <Route path="ustadzah" element={<Ustadzah />} />
            <Route path="kelas" element={<Kelas />} />
            <Route path="pengajuan" element={<Pengajuan />} />
            <Route path="role" element={<Role />} />
            <Route path="akun" element={<Akun />} />
            <Route path="audit" element={<Audit />} />
            <Route path="spp" element={<Spp />} />
            <Route path="bayar" element={<Bayar />} />
            <Route path="lps" element={<Lps />} />
            <Route path="profil" element={<Profil />} />
            <Route path="pengaturan" element={<Pengaturan />} />
            <Route path="agenda" element={<Agenda />} />
            <Route path="kas" element={<Kas />} />
            <Route path="pendaftaran" element={<Pendaftaran />} />
            <Route path="absensi" element={<Absensi />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter></AuthProvider></ToastProvider></QueryClientProvider>
  </React.StrictMode>,
);
