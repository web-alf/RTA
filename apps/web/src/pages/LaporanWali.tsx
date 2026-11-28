import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, Eye, Image as ImageIcon, X } from 'lucide-react';

/** Lebar gambar hasil render (px). Cukup tajam untuk di-zoom di HP, ukuran file tetap wajar. */
const RENDER_W = 1600;

/**
 * Ubah halaman 1 PDF LPS menjadi gambar JPEG di browser wali (pdf.js, build legacy agar jalan di HP lama).
 * Tidak ada gambar yang disimpan di server: PDF dibuat saat diminta dari data LPS + template.
 */
async function pdfToImage(url: string): Promise<Blob> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const data = await fetch(url).then((r) => {
    if (!r.ok) throw new Error('pdf');
    return r.arrayBuffer();
  });
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: RENDER_W / page.getViewport({ scale: 1 }).width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
  doc.destroy();
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('canvas'))), 'image/jpeg', 0.9));
}

/** Halaman publik untuk wali (tanpa login) dari link WA: LPS terbit satu santri langsung tampil sebagai gambar. */
export default function LaporanWali() {
  const { token } = useParams();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [img, setImg] = useState<{ blob: Blob; url: string } | null>(null);
  const [imgFail, setImgFail] = useState(false);
  const [zoom, setZoom] = useState<0 | 1 | 2>(0); // 0 tutup, 1 pas layar, 2 diperbesar
  const pdf = `/api/public/lps/${token}/pdf`;

  useEffect(() => {
    let url = '';
    fetch(`/api/public/lps/${token}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.message);
        setD(j);
        try {
          const blob = await pdfToImage(`${pdf}?view=1`);
          url = URL.createObjectURL(blob);
          setImg({ blob, url });
        } catch {
          setImgFail(true); // HP sangat lama / gagal render: tetap bisa buka PDF
        }
      })
      .catch((e) => setErr(e.message || 'Link tidak berlaku.'));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [token]);

  const fileName = d ? `LPS ${d.who} ${d.periodLabel}.jpg` : 'LPS.jpg';
  async function saveImage() {
    if (!img) return;
    const file = new File([img.blob], fileName, { type: 'image/jpeg' });
    // Di HP, menu bagikan memberi pilihan "Simpan gambar" ke galeri; di desktop langsung unduh.
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e: any) { if (e?.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = img.url;
    a.download = fileName;
    a.click();
  }

  return (
    <div className="min-h-screen bg-page flex justify-center">
      <div className="w-full max-w-[480px] bg-page min-h-screen">
        <header className="px-5 py-4 bg-brand-600 text-white font-display font-black text-lg">Rumah Tahfidz Al-Fatihah</header>
        <main className="px-5 py-6 space-y-4">
          {err && !d && (
            <div className="card p-6 text-center space-y-2">
              <div className="font-display font-black text-lg">Link tidak berlaku</div>
              <p className="text-sm text-n-700">{err}</p>
            </div>
          )}
          {!err && !d && <p className="text-sm text-n-600">Memuat…</p>}
          {d && (
            <>
              <div>
                <h1 className="font-display font-black text-2xl text-brand-900">Assalamu'alaikum, Ayah/Bunda 🌸</h1>
                <p className="text-n-700 mt-1">
                  Laporan Perkembangan Santri <b>Ananda {d.who}</b> · {d.periodLabel}
                </p>
              </div>

              {img ? (
                <div>
                  <button type="button" className="block w-full rounded-2xl overflow-hidden shadow-card" onClick={() => setZoom(1)} aria-label="Perbesar gambar LPS">
                    <img src={img.url} alt={`LPS Ananda ${d.who} ${d.periodLabel}`} className="w-full h-auto block" />
                  </button>
                  <p className="text-sm text-n-600 text-center mt-2">Ketuk gambar untuk memperbesar</p>
                </div>
              ) : imgFail ? (
                <a className="btn-secondary w-full !h-[52px] text-base" href={`${pdf}?view=1`} target="_blank" rel="noreferrer">
                  <Eye size={18} />
                  Lihat LPS
                </a>
              ) : (
                <div className="w-full aspect-[1/1.41] rounded-2xl bg-brand-50 animate-pulse flex items-center justify-center text-sm text-n-600">Menyiapkan laporan…</div>
              )}

              <a className="btn-primary w-full !h-[52px] text-base" href={pdf}>
                <Download size={18} />
                Unduh PDF
              </a>
              {img && (
                <button type="button" className="btn-soft w-full !h-[52px] text-base" onClick={saveImage}>
                  <ImageIcon size={18} />
                  Simpan sebagai gambar
                </button>
              )}
              <p className="text-sm text-n-600 text-center">
                Link berlaku sampai {new Date(d.expiresAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}.
                <br />
                Jazakumullahu khairan atas dukungannya.
              </p>
            </>
          )}
        </main>
      </div>

      {img && zoom > 0 && (
        <div className="fixed inset-0 z-50 bg-black/90 overflow-auto" role="dialog" aria-label="Gambar LPS">
          <button type="button" className="fixed top-3 right-3 z-10 w-11 h-11 rounded-full bg-white/90 text-n-900 flex items-center justify-center" onClick={() => setZoom(0)} aria-label="Tutup">
            <X size={22} />
          </button>
          <img
            src={img.url}
            alt={`LPS Ananda ${d?.who ?? ''}`}
            onClick={() => setZoom(zoom === 1 ? 2 : 1)}
            className={zoom === 1 ? 'w-full max-w-[900px] mx-auto my-auto min-h-full object-contain cursor-zoom-in' : 'max-w-none w-[250%] md:w-[1600px] cursor-zoom-out'}
          />
        </div>
      )}
    </div>
  );
}
