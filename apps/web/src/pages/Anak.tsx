import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Upload } from 'lucide-react';
import { download, get, post, rupiah, tgl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { compressImage, sizeLabel } from '../lib/image';
import { useToast } from '../components/Toast';
import { Alert, Avatar, Badge, Card, Empty, PageHeader } from '../components/ui';
import { BankList } from '../components/BankList';

/** Portal akun wali: tagihan + unggah bukti, dan LPS terbit anak di keluarganya. Data minimum (tanpa label subsidi). */
const BILL: Record<string, [string, string]> = { TUNGGAKAN: ['Belum dibayar', 'text-danger-fg'], MENUNGGU: ['Sedang diperiksa', 'text-lilac-fg'], BELUM: ['Bulan ini', 'text-butter-fg'] };

export default function Anak() {
  const { user } = useAuth(); const toast = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['portal'], queryFn: () => get('/portal') });
  const [file, setFile] = useState<File | null>(null); const [orig, setOrig] = useState(0);
  const pick = async (f?: File) => { if (!f) return; setOrig(f.size); setFile(await compressImage(f)); };
  const send = useMutation({
    mutationFn: () => { const fd = new FormData(); fd.append('file', file!); return post('/portal/bukti', fd); },
    onSuccess: () => { toast('Bukti sudah kami terima. Jazakumullahu khairan.'); setFile(null); qc.invalidateQueries({ queryKey: ['portal'] }); },
    onError: (e: any) => toast(e.message, 'danger'),
  });
  if (q.error) return <div className="space-y-5"><PageHeader title="Tagihan" /><Alert>{(q.error as any).message}</Alert></div>;
  if (!q.data) return <p className="text-sm text-n-600">Memuat…</p>;
  const { kids, tagihan: t, lps } = q.data;

  return (
    <div className="space-y-6">
      <PageHeader title={`Assalamu'alaikum, ${user?.name ?? 'Bapak/Ibu'}`} sub="Tagihan dan laporan perkembangan (LPS) putra-putri Bapak/Ibu di Rumah Tahfidz Al-Fatihah." />

      <section aria-label="Anak" className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {kids.map((k: any) => (
          <div key={k.id} className="card p-4 flex items-center gap-3"><Avatar name={k.fullName} /><div className="flex-1 min-w-0"><div className="font-bold truncate">{k.fullName}</div><div className="text-xs text-n-600 truncate">{k.className} · {k.branchName}</div></div><Badge status={k.status} /></div>))}
      </section>

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <Card title="Tagihan">
          {!t.bills.length ? <Empty text="Tidak ada tagihan yang perlu dibayar. Jazakumullahu khairan." /> : <div className="space-y-3">
            {t.bills.map((b: any, i: number) => (
              <div key={i} className="flex justify-between items-center gap-3"><div><div className="font-semibold">{b.who}</div><div className="text-xs text-n-600">{b.label}</div></div>
                <div className="text-right"><div className="num">{rupiah(b.amount)}</div><div className={`text-[11px] font-bold ${BILL[b.status]?.[1] ?? 'text-n-600'}`}>{BILL[b.status]?.[0] ?? b.status}</div></div></div>))}
            <div className="flex justify-between items-center pt-3 border-t-[1.5px] border-dashed border-n-300"><b>Total perlu dibayar</b><span className="num text-2xl text-brand-700">{rupiah(t.total)}</span></div>
          </div>}
          {t.total > 0 ? <div className="space-y-4 mt-5">
            <BankList banks={t.banks ?? []} />
            <label className="flex items-center gap-3 p-4 rounded-2xl border-2 border-dashed border-brand-300 bg-white cursor-pointer">
              <span className="w-14 h-16 rounded-xl bg-n-50 text-brand-700 flex items-center justify-center shrink-0"><Upload /></span>
              <span className="flex-1 text-sm">{file ? <><b className="block">{file.name}</b><span className="text-mint-fg font-semibold text-xs">{sizeLabel(orig)} → {sizeLabel(file.size)}, siap dikirim</span><span className="block text-xs text-n-600">Ketuk untuk ganti foto</span></> : <><b className="block">Sudah transfer? Pilih foto bukti</b><span className="text-xs text-n-600">Foto layar atau struk, JPG/PNG/PDF</span></>}</span>
              <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} /></label>
            <button className="btn-primary w-full !h-12" disabled={!file || send.isPending} onClick={() => send.mutate()}>{send.isPending ? 'Mengirim…' : 'Kirim bukti'}</button>
            <p className="text-xs text-n-600 text-center">Status menjadi lunas setelah diperiksa PJ RTA.</p>
          </div> : t.waiting && <p className="mt-4 text-sm text-n-700">Bukti pembayaran Bapak/Ibu sedang diperiksa. Jazakumullahu khairan.</p>}
        </Card>

        <Card title="Laporan Perkembangan Santri (LPS)">
          {!lps.length ? <Empty icon={FileText} text="Belum ada LPS yang terbit." /> : <ul className="divide-y divide-n-100 -my-2">
            {lps.map((r: any) => (
              <li key={r.id} className="flex items-center gap-3 py-3">
                <span className="w-10 h-10 rounded-xl bg-mint-bg text-mint-fg flex items-center justify-center shrink-0"><FileText size={18} /></span>
                <div className="flex-1 min-w-0"><div className="font-semibold truncate">{r.who} · {r.label}</div><div className="text-xs text-n-600">Capaian hafalan {r.hafalanPercent ?? '-'}% · terbit {tgl(r.publishedAt)}</div></div>
                <button className="btn-secondary !h-11 shrink-0" aria-label={`Unduh LPS ${r.who} ${r.label}`} onClick={() => download(`/portal/lps/${r.id}/pdf`, `LPS-${r.who}-${String(r.period).slice(0, 7)}.pdf`).catch((e) => toast(e.message, 'danger'))}><Download size={14} />Unduh</button>
              </li>))}
          </ul>}
        </Card>
      </div>
    </div>
  );
}
