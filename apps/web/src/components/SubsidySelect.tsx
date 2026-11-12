import { useQuery } from '@tanstack/react-query';
import { get, rupiah } from '../lib/api';
import { Field } from './ui';

/** Pilih kategori subsidi (master di menu Pengaturan). Hanya kategori aktif yang berlaku di cabang santri (prd.md 8.2 aturan 6). */
export function SubsidySelect({ branchId, value, onChange, legacy }: { branchId?: number; value: string; onChange: (v: string) => void; legacy?: string | null }) {
  const q = useQuery({ queryKey: ['subsidies'], queryFn: () => get('/subsidies') });
  const opts = (q.data ?? []).filter((x: any) => x.isActive).map((x: any) => ({ ...x, rate: x.rates.find((r: any) => r.branchId === branchId && r.available) })).filter((x: any) => x.rate);
  const cur = opts.find((x: any) => String(x.id) === value);
  const hint = cur ? `Tarif SPP menjadi ${rupiah(cur.rate.amount)}${cur.rate.note ? ` · ${cur.rate.note}` : ''}${cur.isSibling ? ' · butuh saudara Aktif; saudara Aktif yang masih Reguler ikut dipasang otomatis; dicabut otomatis bila saudara cuti/keluar' : ''}`
    : legacy ? `Label lama "${legacy}" belum terhubung ke kategori. Pilih kategori agar tarif mengikuti Pengaturan.` : 'Rahasia: hanya terlihat PJ & ustadzah, tidak muncul di pesan WA maupun halaman wali.';
  return (
    <Field label="Kategori subsidi (rahasia)" hint={hint}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} disabled={!branchId}>
        <option value="">{legacy && !value ? `${legacy} (label lama)` : 'Reguler (tanpa subsidi)'}</option>
        {legacy && !value && <option value="none">Cabut subsidi</option>}
        {opts.map((x: any) => <option key={x.id} value={x.id}>{x.name} · {rupiah(x.rate.amount)}</option>)}
      </select>
    </Field>
  );
}
