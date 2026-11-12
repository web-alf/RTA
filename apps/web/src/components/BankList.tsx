import { useState } from 'react';
import { Copy } from 'lucide-react';

type Bank = { name: string; account: string; holder: string; branches: string[]; total: number };
const rupiah = (n: number) => 'Rp' + n.toLocaleString('id-ID');

/** Rekening transfer untuk wali (halaman publik & portal). Lebih dari satu = anak di cabang berbeda: tampilkan nominal per rekening. */
export function BankList({ banks, className = 'rounded-2xl bg-n-50 p-4' }: { banks: Bank[]; className?: string }) {
  const [copied, setCopied] = useState('');
  const copy = async (acc: string) => {
    await navigator.clipboard?.writeText(acc.replace(/[\s.-]/g, ''));
    setCopied(acc);
    setTimeout(() => setCopied(''), 2000);
  };
  const many = banks.length > 1;
  return (
    <div className="space-y-3">
      {banks.map((b) => (
        <section key={b.account} className={`${className} space-y-1.5`}>
          <div className="text-xs text-n-600">
            {many ? <>Transfer untuk tagihan cabang <b>{b.branches.join(' & ')}</b> · {rupiah(b.total)}</> : 'Transfer ke rekening yayasan'}
          </div>
          <div className="font-bold">
            {b.name} · a.n. {b.holder}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="num text-xl tracking-wide break-all">{b.account}</span>
            <button onClick={() => copy(b.account)} className="btn-soft !h-11 !px-3 shrink-0" aria-label={`Salin nomor rekening ${b.name}`}>
              <Copy size={14} />
              {copied === b.account ? 'Tersalin' : 'Salin'}
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
