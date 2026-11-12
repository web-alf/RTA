import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { download } from '../lib/api';
import { useToast } from './Toast';

/** Tombol "Ekspor" dengan pilihan Excel (untuk diolah) dan PDF (untuk dicetak/dibagikan). path tanpa ekstensi, mis. "/spp/export". */
export function ExportMenu({ path, query = '', file, className = '' }: { path: string; query?: string; file: string; className?: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  const go = async (ext: 'xlsx' | 'pdf') => {
    setOpen(false); setBusy(ext);
    try { await download(`${path}.${ext}${query ? `?${query}` : ''}`, `${file}.${ext}`); toast(`Laporan ${ext === 'xlsx' ? 'Excel' : 'PDF'} diunduh`); }
    catch (e: any) { toast(e.message, 'danger'); }
    finally { setBusy(''); }
  };
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" className="btn-secondary !h-11 w-full" aria-haspopup="menu" aria-expanded={open} disabled={!!busy} onClick={() => setOpen(!open)}>
        <Download size={16} /> {busy ? 'Menyiapkan…' : 'Ekspor'} <ChevronDown size={15} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 z-30 w-56 card p-1.5 shadow-float">
          <button role="menuitem" className="w-full flex items-center gap-3 px-3 min-h-[44px] rounded-xl hover:bg-n-50 text-left text-sm" onClick={() => go('xlsx')}>
            <FileSpreadsheet size={18} className="text-success-fg" /><span><b className="block">Excel (.xlsx)</b><span className="text-xs text-n-600">untuk diolah</span></span>
          </button>
          <button role="menuitem" className="w-full flex items-center gap-3 px-3 min-h-[44px] rounded-xl hover:bg-n-50 text-left text-sm" onClick={() => go('pdf')}>
            <FileText size={18} className="text-danger-fg" /><span><b className="block">PDF</b><span className="text-xs text-n-600">untuk dicetak / dibagikan</span></span>
          </button>
        </div>
      )}
    </div>
  );
}
