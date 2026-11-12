import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { can, get, post, rupiah, tgl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Avatar, Badge, Drawer, Empty, Field, KV, PageHeader } from '../components/ui';
import { useToast } from '../components/Toast';

const COLS = [
  { key: 'MENUNGGU', title: 'Menunggu', bg: 'bg-brand-50', fg: 'text-brand-700', states: ['MENUNGGU'] },
  { key: 'DISETUJUI', title: 'Disetujui', bg: 'bg-[#f0f9f4]', fg: 'text-mint-fg', states: ['DISETUJUI'] },
  { key: 'DITOLAK', title: 'Ditolak & ditarik', bg: 'bg-[#fdf5f4]', fg: 'text-danger-fg', states: ['DITOLAK', 'DITARIK'] },
];

export default function Pengajuan() {
  const q = useQuery({ queryKey: ['requests', 'all'], queryFn: async () => (await Promise.all(['MENUNGGU', 'DISETUJUI', 'DITOLAK', 'DITARIK'].map((s) => get(`/requests?state=${s}`)))).flat() });
  const [open, setOpen] = useState<number | null>(null);
  const all: any[] = q.data ?? [];
  return (
    <div>
      <PageHeader title="Pengajuan keluar & mutasi" sub="Selama menunggu, santri tetap dihitung aktif di cabang asal." />
      <div className="flex md:grid md:grid-cols-3 gap-4 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 pb-2 items-start">
        {COLS.map((c) => { const items = all.filter((r) => c.states.includes(r.state)); return (
          <section key={c.key} className={`${c.bg} rounded-[28px] p-3.5 space-y-3 shrink-0 w-[86vw] md:w-auto`}>
            <div className="flex items-center justify-between px-1.5 pt-1"><h2 className="h2">{c.title}</h2><span className={`min-w-[26px] h-[26px] px-2 rounded-full bg-white ${c.fg} text-xs font-extrabold flex items-center justify-center`}>{items.length}</span></div>
            {items.length === 0 ? <div className="text-sm text-n-600 text-center py-8">Kosong</div> : items.slice(0, 30).map((r) => (
              <button key={r.id} onClick={() => setOpen(r.id)} className="card w-full text-left p-4 space-y-2.5 hover:-translate-y-0.5 transition">
                <div className="flex items-center gap-2"><span className={`pill ${r.type === 'MUTASI' ? 'bg-lilac-bg text-lilac-fg' : 'bg-butter-bg text-butter-fg'}`}>{r.type === 'MUTASI' ? 'Mutasi' : 'Keluar'}</span>{r.state === 'DITARIK' && <Badge status="DITARIK" />}<span className="ml-auto text-xs text-n-600">efektif {tgl(r.effectiveDate)}</span></div>
                <div className="font-display font-extrabold">{r.studentName}</div>
                <div className="text-[13px] text-n-700">{r.branchName}{r.type === 'MUTASI' ? <> → <b>{r.targetBranch}</b></> : ''}</div>
                <div className="text-[13px] text-n-700 px-3 py-2 rounded-xl bg-n-50">{r.reason}</div>
                <div className="text-xs text-n-600">{r.requestedBy} · {tgl(r.createdAt)}</div>
              </button>))}
          </section>); })}
      </div>
      {q.data && all.length === 0 && <Empty text="Belum ada pengajuan." />}
      {open && <Tinjau id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Tinjau({ id, onClose }: { id: number; onClose: () => void }) {
  const { user } = useAuth(); const toast = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['request', id], queryFn: () => get(`/requests/${id}`) });
  const [note, setNote] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const r = q.data;
  const act = async (a: 'approve' | 'reject' | 'withdraw') => {
    setErr(''); if (a === 'reject' && note.trim().length < 2) return setErr('Catatan wajib diisi bila menolak.');
    setBusy(true);
    try { await post(`/requests/${id}/${a}`, a === 'withdraw' ? undefined : { note: note || undefined }); toast(a === 'approve' ? 'Pengajuan disetujui' : a === 'reject' ? 'Pengajuan ditolak' : 'Pengajuan ditarik'); qc.invalidateQueries(); onClose(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const decide = r?.state === 'MENUNGGU' && can(user, 'pengajuan.setujui');
  return (
    <Drawer open onClose={onClose} title={r?.state === 'MENUNGGU' ? 'Tinjau pengajuan' : 'Detail pengajuan'} sub={r && `Diajukan ${r.requestedBy} · ${tgl(r.createdAt)}`}
      badge={r && <span className={`pill ${r.type === 'MUTASI' ? 'bg-lilac-bg text-lilac-fg' : 'bg-butter-bg text-butter-fg'}`}>{r.type === 'MUTASI' ? 'Mutasi' : 'Keluar'} · {r.state.toLowerCase()}</span>}
      footer={r?.state === 'MENUNGGU' ? (decide ? <div className="space-y-2.5"><p className="text-xs text-n-600">{r.type === 'MUTASI' ? `Setelah disetujui: santri pindah pada tanggal efektif, tagihan berikutnya memakai tarif ${r.to?.branch}, dan biaya pindah ditagihkan.` : 'Setelah disetujui: santri berstatus Keluar (diarsipkan, tidak dihapus).'}</p>
        <div className="flex gap-3"><button className="btn-secondary flex-1 !text-danger-fg" disabled={busy} onClick={() => act('reject')}>Tolak</button><button className="btn-primary flex-[2]" disabled={busy} onClick={() => act('approve')}>Setujui {r.type === 'MUTASI' ? 'mutasi' : 'keluar'}</button></div></div>
        : <button className="btn-secondary w-full !text-danger-fg" disabled={busy} onClick={() => act('withdraw')}>Tarik pengajuan</button>) : undefined}>
      {!r ? <div className="text-sm text-n-600">Memuat…</div> : <>
        {err && <Alert>{err}</Alert>}
        <Link to={`/santri/${r.student.id}`} className="card p-4 flex items-center gap-3"><Avatar name={r.student.name} size={48} square /><div className="flex-1"><div className="font-display font-extrabold">{r.student.name}</div><div className="text-xs text-n-600">{r.student.nis} · Kel. {r.student.wali}{r.student.hafalan != null ? ` · hafalan ${String(r.student.hafalan).replace('.', ',')}%` : ''}</div></div><span className="text-sm font-semibold">Profil ›</span></Link>
        {r.to ? <div className="flex items-stretch gap-3">
          <div className="card flex-1 p-4"><div className="text-xs text-n-600">Dari</div><div className="font-display font-black text-lg">{r.from.branch}</div><div className="text-[13px] text-n-700">{r.from.className}<br />SPP {rupiah(r.from.spp)}</div></div>
          <span className="self-center w-10 h-10 rounded-full bg-brand-600 text-white flex items-center justify-center shadow-brand shrink-0"><ArrowRight size={18} /></span>
          <div className="flex-1 p-4 rounded-card bg-brand-50 border-2 border-brand-200"><div className="text-xs text-n-600">Ke</div><div className="font-display font-black text-lg text-brand-700">{r.to.branch}</div><div className="text-[13px] text-n-700">{r.to.className}<br />SPP {rupiah(r.to.spp)}</div></div>
        </div> : <KV rows={[['Cabang', r.from.branch], ['Kelas', r.from.className]]} />}
        <KV rows={[['Tanggal efektif', tgl(r.effectiveDate)], ['Alasan', r.reason], ...(r.note ? [['Catatan ustadzah', r.note] as [string, any]] : []), ...(r.to ? [['Biaya pindah', `${rupiah(r.moveFee)} (daftar ulang tahun ini)`] as [string, any]] : []), ...(r.decisionNote ? [['Catatan PJ', r.decisionNote] as [string, any]] : [])]} />
        <div className="flex flex-wrap gap-2">
          <span className={`pill h-8 ${r.checks.tunggakan ? 'bg-danger-bg text-danger-fg' : 'bg-mint-bg text-mint-fg'}`}>{r.checks.tunggakan ? `! Tunggakan ${rupiah(r.checks.tunggakan)}` : '✓ Tanpa tunggakan'}</span>
          {r.to && <span className={`pill h-8 ${r.checks.kelasTersedia ? 'bg-mint-bg text-mint-fg' : 'bg-danger-bg text-danger-fg'}`}>{r.checks.kelasTersedia ? '✓ Kelas tersedia' : '! Kelas tujuan tidak ada'}</span>}
          {r.to && r.to.spp !== r.from.spp && <span className="pill h-8 bg-butter-bg text-butter-fg">! Tarif {r.to.spp > r.from.spp ? 'naik' : 'turun'} {rupiah(Math.abs(r.to.spp - r.from.spp))}</span>}
        </div>
        {decide && <Field label="Catatan PJ (wajib bila menolak)"><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tulis catatan untuk ustadzah" /></Field>}
      </>}
    </Drawer>
  );
}
