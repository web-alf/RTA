import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Upload } from 'lucide-react';
import { compressImage, sizeLabel } from '../lib/image';
import { BankList } from '../components/BankList';

/** Halaman publik untuk wali (tanpa login): rincian tagihan + unggah bukti. Hanya data minimum (nama panggilan, nominal). */
const rupiah = (n: number) => 'Rp' + n.toLocaleString('id-ID');
export default function BayarWali() {
  const { token } = useParams();
  const [d, setD] = useState<any>(null); const [err, setErr] = useState('');
  const [file, setFile] = useState<File | null>(null); const [orig, setOrig] = useState(0);
  const [busy, setBusy] = useState(false); const [sent, setSent] = useState<any>(null);
  useEffect(() => { fetch(`/api/public/tagihan/${token}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.message); setD(j); }).catch((e) => setErr(e.message)); }, [token]);
  const pick = async (f?: File) => { if (!f) return; setOrig(f.size); setFile(await compressImage(f)); };
  const send = async () => {
    if (!file) return; setBusy(true); setErr('');
    const fd = new FormData(); fd.append('file', file);
    try { const r = await fetch(`/api/public/tagihan/${token}/bukti`, { method: 'POST', body: fd }); const j = await r.json(); if (!r.ok) throw new Error(j.message); setSent(j); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen bg-page flex justify-center">
      <div className="w-full max-w-[440px] bg-page min-h-screen">
        <header className="px-5 pt-6 pb-5 bg-brand-50 rounded-b-[32px] flex items-center gap-3"><span className="w-10 h-10 rounded-[14px] bg-brand-600 text-white flex items-center justify-center font-display font-black">R</span><div><div className="font-display font-black">Rumah Tahfidz Al-Fatihah</div><div className="text-xs text-n-600">Tagihan & bukti pembayaran</div></div></header>
        <main className="px-5 py-6 space-y-5">
          {err && !d && <div className="card p-6 text-center space-y-2"><div className="font-display font-black text-lg">Link tidak berlaku</div><p className="text-sm text-n-700">{err}</p></div>}
          {sent ? (
            <div className="text-center space-y-5 pt-6">
              <div className="mx-auto w-28 h-28 rounded-full bg-mint-bg flex items-center justify-center"><span className="w-20 h-20 rounded-full bg-success text-white flex items-center justify-center"><Check size={40} strokeWidth={3} /></span></div>
              <div><h1 className="font-display font-black text-2xl">Bukti sudah kami terima</h1><p className="text-sm text-n-700 mt-2">Ustadzah akan mencocokkan dengan mutasi bank. Status menjadi lunas setelah diperiksa.</p></div>
              <div className="card p-4 text-left text-sm space-y-2"><div className="flex justify-between"><span className="text-n-600">Dikirim</span><b>{new Date(sent.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</b></div><div className="flex justify-between"><span className="text-n-600">Total</span><b>{rupiah(sent.total)}</b></div><div className="flex justify-between items-center"><span className="text-n-600">Status</span><span className="pill bg-lilac-bg text-lilac-fg">Menunggu verifikasi</span></div></div>
              <div className="font-semibold text-brand-800">Jazakumullahu khairan</div>
            </div>
          ) : d && (<>
            <div><h1 className="font-display font-black text-2xl">Assalamu'alaikum, Bapak/Ibu</h1><p className="text-sm text-n-700 mt-1">Berikut tagihan untuk keluarga Bapak/Ibu.</p></div>
            <section className="card p-4 space-y-3">
              {d.bills.map((b: any, i: number) => <div key={i} className="flex justify-between items-center gap-3"><div><div className="font-semibold">{b.who}</div><div className="text-xs text-n-600">{b.label}</div></div><div className="text-right"><div className="num">{rupiah(b.amount)}</div><div className={`text-[11px] font-bold ${b.status === 'TUNGGAKAN' ? 'text-danger-fg' : b.status === 'MENUNGGU' ? 'text-lilac-fg' : 'text-butter-fg'}`}>{b.status === 'TUNGGAKAN' ? 'Belum dibayar' : b.status === 'MENUNGGU' ? 'Sedang diperiksa' : 'Bulan ini'}</div></div></div>)}
              <div className="flex justify-between items-center pt-3 border-t-[1.5px] border-dashed border-n-300"><b>Total</b><span className="num text-2xl text-brand-700">{rupiah(d.total)}</span></div>
            </section>
            {d.total > 0 ? <>
              <BankList banks={d.banks ?? []} className="card p-4" />
              <h2 className="font-display font-extrabold text-base">Sudah transfer? Kirim buktinya</h2>
              <label className="flex items-center gap-3 p-4 rounded-2xl border-2 border-dashed border-brand-300 bg-white cursor-pointer">
                <span className="w-14 h-16 rounded-xl bg-n-50 text-brand-700 flex items-center justify-center shrink-0"><Upload /></span>
                <span className="flex-1 text-sm">{file ? <><b className="block">{file.name}</b><span className="text-mint-fg font-semibold text-xs">{sizeLabel(orig)} → {sizeLabel(file.size)}, siap dikirim</span><span className="block text-xs text-n-600">Ketuk untuk ganti foto</span></> : <><b className="block">Pilih foto bukti transfer</b><span className="text-xs text-n-600">Foto layar atau struk, JPG/PNG/PDF</span></>}</span>
                <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} /></label>
              {err && <div role="alert" className="text-sm text-danger-fg bg-danger-bg rounded-2xl px-4 py-3">{err}</div>}
              <button className="btn-primary w-full !h-[52px] text-base" disabled={!file || busy} onClick={send}>{busy ? 'Mengirim…' : 'Kirim bukti'}</button>
              <p className="text-xs text-n-600 text-center">Atau kirim foto bukti ke WhatsApp ustadzah. Keduanya akan dicek.</p>
            </> : <div className="card p-4 text-sm text-n-700">{d.waiting ? 'Bukti pembayaran Bapak/Ibu sedang diperiksa. Jazakumullahu khairan.' : 'Tidak ada tagihan yang perlu dibayar. Jazakumullahu khairan.'}</div>}
          </>)}
        </main>
      </div>
    </div>
  );
}
