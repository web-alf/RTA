import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Check, Lock } from 'lucide-react';
import { can, get, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/ui';
import { useToast } from '../components/Toast';

const CRITICAL = ['role.', 'akun.', 'pengajuan.setujui', 'bayar.setujui', 'lps.setujui', 'audit.'];
const MENU_LABEL: Record<string, string> = { dashboard: 'Beranda', spp: 'SPP', bayar: 'Bayar', lps: 'LPS', audit: 'Audit log', portal: 'Portal wali' };
const ROLE_SUB: Record<string, string> = { PJ: 'inti · semua cabang · admin', WALI: 'data keluarga sendiri', USTADZAH: 'cabang ditugaskan', MANAJER: 'lihat & ekspor' };
const ROLE_INI: Record<string, string> = { PJ: 'PJ', USTADZAH: 'US', MANAJER: 'MN', WALI: 'WS' };
const NA = (m: string, a: string) => (a === 'setujui' && !['pengajuan', 'bayar', 'lps'].includes(m)) || (m === 'portal' && !['lihat', 'input'].includes(a));

export default function Role() {
  const { user } = useAuth(); const toast = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['roles'], queryFn: () => get('/roles') });
  const [roleId, setRoleId] = useState<number | null>(null); const [perms, setPerms] = useState<string[] | null>(null);
  const role = q.data?.roles.find((r: any) => r.id === (roleId ?? q.data?.roles[0]?.id));
  const cur: string[] = perms ?? role?.perms ?? [];
  const toggle = (p: string) => setPerms(cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]);
  const save = async () => {
    const changed = [...cur.filter((p) => !role.perms.includes(p)), ...role.perms.filter((p: string) => !cur.includes(p))];
    if (changed.some((p) => CRITICAL.some((c) => p.startsWith(c))) && !confirm('Anda mengubah hak akses kritis (role, akun, persetujuan, audit). Lanjutkan?')) return;
    try { await put(`/roles/${role.id}/perms`, { perms: cur }); toast('Hak akses disimpan. Berlaku saat login berikutnya.'); setPerms(null); qc.invalidateQueries({ queryKey: ['roles'] }); } catch (e: any) { toast(e.message, 'danger'); }
  };
  if (!q.data) return null;
  const editable = can(user, 'role.edit');
  return (
    <div className="space-y-5">
      <PageHeader title="Role & hak akses" sub="Centang menu yang boleh dibuka tiap jabatan. Berlaku saat login berikutnya." />
      <div role="tablist" aria-label="Pilih role" className="flex gap-3 overflow-x-auto -mx-4 px-4 pb-2 md:mx-0 md:px-0">
        {q.data.roles.map((r: any) => { const on = r.id === role?.id; return (
          <button key={r.id} role="tab" aria-selected={on} onClick={() => { setRoleId(r.id); setPerms(null); }} className={`shrink-0 flex items-center gap-3 pl-2.5 pr-4 py-2.5 rounded-2xl text-left ${on ? 'bg-brand-600 text-white shadow-brand' : 'bg-white shadow-card'}`}>
            <span className={`w-9 h-9 rounded-xl flex items-center justify-center font-display font-black ${on ? 'bg-white text-brand-600' : 'bg-n-50 text-brand-800'}`}>{ROLE_INI[r.code] ?? r.code.slice(0, 2)}</span>
            <span><span className="block font-bold text-sm">{r.name}</span><span className={`block text-xs ${on ? 'text-white/85' : 'text-n-600'}`}>{ROLE_SUB[r.code] ?? ''}</span></span></button>); })}
      </div>
      {role?.isCore && <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-lilac-bg text-lilac-fg text-sm"><Lock size={16} />Role inti: tidak bisa dihapus dan tidak bisa kehilangan akses menu Role & Akun.</div>}
      <div className="card overflow-x-auto"><table className="w-full min-w-[640px]">
        <thead><tr><th className="th pl-5 pt-4">Menu</th>{q.data.actions.map((a: string) => <th key={a} className="th pt-4 text-center capitalize">{a}</th>)}</tr></thead>
        <tbody>{q.data.menus.map((m: string) => <tr key={m}><td className="td pl-5 font-semibold">{MENU_LABEL[m] ?? m[0].toUpperCase() + m.slice(1)}</td>
          {q.data.actions.map((a: string) => { const p = `${m}.${a}`; const on = cur.includes(p); const dirty = role && on !== role.perms.includes(p); const na = NA(m, a); return (
            <td key={p} className="td text-center">{na ? <span className="text-n-300">–</span> :
              <button type="button" role="checkbox" aria-checked={on} aria-label={`${MENU_LABEL[m] ?? m} ${a}`} disabled={!editable} onClick={() => toggle(p)}
                className={`w-7 h-7 rounded-[10px] inline-flex items-center justify-center transition ${dirty ? 'bg-butter-bg text-butter-fg ring-2 ring-butter-solid' : on ? 'bg-brand-600 text-white' : 'bg-n-50 ring-[1.5px] ring-inset ring-n-300 text-transparent'}`}><Check size={16} strokeWidth={3} /></button>}</td>); })}</tr>)}</tbody></table></div>
      {editable && <div className="flex justify-end gap-3"><button className="btn-text" disabled={!perms} onClick={() => setPerms(null)}>Batalkan perubahan</button><button className="btn-primary" disabled={!perms} onClick={save}>Simpan</button></div>}
      <p className="text-xs text-n-600">Hak akses selalu dibatasi lagi oleh scope cabang di server. “Setujui” berlaku untuk Pengajuan, Bayar (verifikasi), dan LPS. Portal wali hanya untuk akun wali: lihat tagihan & LPS terbit anaknya, input = unggah bukti bayar. Kotak kuning = perubahan belum disimpan.</p>
    </div>
  );
}
