import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, BookOpen, FileText, Minus, Package, Plus, ReceiptText, Search, Shirt, Star, Upload, Wallet } from 'lucide-react';
import { can, get, monthWIB, patch, post, rupiah, tgl, todayWIB } from '../lib/api';
import { useAuth } from '../lib/auth';
import { compressImage, sizeLabel } from '../lib/image';
import { useToast } from '../components/Toast';
import { Alert, Avatar, Badge, Bar, Card, Chips, Dialog, Drawer, Empty, Field, PageHeader, PASTEL, SearchBox, Segmented } from '../components/ui';
import { UploadDrawer } from './Bayar';
import { ExportMenu } from '../components/ExportMenu';

const ICON: Record<string, any> = { BOOK: BookOpen, SHIRT: Shirt, STAR: Star, BOX: Package };
const ICON_LABEL: Record<string, string> = { BOOK: 'Buku', SHIRT: 'Pakaian', STAR: 'Prestasi', BOX: 'Barang' };
const TONE: Record<string, string> = { BOOK: 'bg-rose-bg text-rose-fg', SHIRT: 'bg-butter-bg text-butter-fg', STAR: 'bg-lilac-bg text-lilac-fg', BOX: 'bg-mint-bg text-mint-fg' };
const METHOD: Record<string, string> = { TUNAI: 'Tunai', TRANSFER: 'Transfer', TAGIHAN: 'Ditagihkan ke wali' };
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const pendek = (d: string) => new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
const lastMonths = (n: number) => {
  const [y, m] = monthWIB().split('-').map(Number);
  return Array.from({ length: n }, (_, k) => { const d = new Date(Date.UTC(y, m - 1 - k, 1)); return d.toISOString().slice(0, 7); });
};
const monthName = (ym: string) => `${BULAN[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;

/** Status/cara bayar satu transaksi (teks kecil di bawah cara bayar) */
function txStatus(t: any): { text: string; tone: string } | null {
  if (t.kind === 'KELUAR') {
    if (t.state === 'MENUNGGU') return { text: 'menunggu persetujuan PJ', tone: 'text-warning-fg' };
    if (t.state === 'DITOLAK') return { text: `ditolak${t.reason ? `: ${t.reason}` : ''}`, tone: 'text-danger-fg' };
    if (t.state === 'DIBATALKAN') return { text: `dibatalkan${t.reason ? `: ${t.reason}` : ''}`, tone: 'text-n-600' };
    if (t.restock) return { text: `✓ ${t.hasProof ? 'nota · ' : ''}stok ${t.restock}`, tone: 'text-success-fg' };
    return t.hasProof ? { text: '✓ nota terlampir', tone: 'text-success-fg' } : null;
  }
  if (t.kind === 'JUAL') {
    if (t.canceled) return { text: 'dibatalkan', tone: 'text-n-600' };
    if (t.method === 'TAGIHAN') return t.invoiceStatus === 'LUNAS' ? { text: 'lunas', tone: 'text-success-fg' } : t.invoiceStatus === 'MENUNGGU' ? { text: 'bukti diperiksa', tone: 'text-lilac-fg' } : { text: 'belum dibayar', tone: 'text-warning-fg' };
    return t.createdBy ? { text: `oleh ${t.createdBy}`, tone: 'text-n-600' } : null;
  }
  return { text: 'pelunasan dari menu Bayar', tone: 'text-n-600' };
}
const sign = (t: any) => (t.kind === 'KELUAR' ? '−' : '+');
const amountCls = (t: any) => (!t.counted ? 'text-n-500' : t.kind === 'KELUAR' ? 'text-danger-fg' : 'text-success-fg');
const txMethod = (t: any) => (t.kind === 'MASUK' ? t.method : METHOD[t.method] ?? t.method);

/** Grafik batang ganda masuk vs keluar (SVG ringan) */
function Chart({ data }: { data: { label: string; masuk: number; keluar: number }[] }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.masuk, d.keluar]));
  const H = 170;
  return (
    <div role="img" aria-label={`Pemasukan dan pengeluaran 6 bulan: ${data.map((d) => `${d.label} masuk ${rupiah(d.masuk)}, keluar ${rupiah(d.keluar)}`).join('; ')}`} className="flex items-end justify-between gap-2 pt-2" style={{ height: H + 28 }}>
      {data.map((d) => (
        <div key={d.label} className="flex-1 flex flex-col items-center gap-2 min-w-0">
          <div className="flex items-end gap-1.5" style={{ height: H }}>
            <div className="w-4 sm:w-6 rounded-t-lg bg-[#5fb38a]" style={{ height: Math.max(3, (d.masuk / max) * H) }} title={`Masuk ${rupiah(d.masuk)}`} />
            <div className="w-4 sm:w-6 rounded-t-lg bg-[#e46a5a]" style={{ height: Math.max(3, (d.keluar / max) * H) }} title={`Keluar ${rupiah(d.keluar)}`} />
          </div>
          <div className="text-xs text-n-600">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Kartu ringkasan berwarna; nominal tidak pernah terpotong (ikon disembunyikan saat kolom sempit) */
function KasStat({ icon: Icon, tone, value, label, onClick, active }: { icon: any; tone: number; value: number; label: string; onClick?: () => void; active?: boolean }) {
  const p = PASTEL[tone];
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} aria-pressed={onClick ? !!active : undefined} className={`${p.bg} rounded-card p-3.5 sm:p-4 text-left flex items-center gap-3 min-w-0 ${onClick ? 'hover:-translate-y-0.5 transition' : ''} ${active ? 'ring-2 ring-brand-600' : ''}`}>
      <span className={`bg-white ${p.fg} rounded-[14px] hidden sm:inline-flex lg:hidden 2xl:inline-flex items-center justify-center shrink-0 w-11 h-11`}><Icon size={20} aria-hidden /></span>
      <div className="min-w-0"><div className="num text-lg sm:text-xl 2xl:text-2xl leading-tight text-n-900 whitespace-nowrap">{rupiah(value)}</div><div className={`text-xs mt-1 ${p.fg}`}>{label}</div></div>
    </Tag>
  );
}

function Selisih({ k }: { k: any }) {
  return (
    <section className="rounded-card bg-brand-600 text-white p-5">
      <div className="text-sm opacity-90">Selisih {k.label}</div>
      <div className="num text-3xl mt-1 break-all">{k.summary.selisih >= 0 ? '+' : '−'}{rupiah(Math.abs(k.summary.selisih))}</div>
      <div className="text-xs opacity-90 mt-1">Masuk {rupiah(k.summary.masuk)} − keluar {rupiah(k.summary.keluar)}</div>
    </section>
  );
}

export default function Kas() {
  const { user } = useAuth();
  const canInput = can(user, 'kas.input'), canEdit = can(user, 'kas.edit');
  const [month, setMonth] = useState(monthWIB());
  const [branchId, setBranchId] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [q, setQ] = useState('');
  const [jual, setJual] = useState<any>(null); // {} = baru, {student} = santri terpilih
  const [keluar, setKeluar] = useState(false);
  const [katalog, setKatalog] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [payFam, setPayFam] = useState<any>(null);
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => get('/branches'), enabled: !user?.branchIds });
  const d = useQuery({ queryKey: ['kas', month, branchId], queryFn: () => get(`/kas?month=${month}${branchId ? `&branchId=${branchId}` : ''}`) });
  const cat = useQuery({ queryKey: ['kas-catalog', branchId], queryFn: () => get(`/kas/catalog${branchId ? `?branchId=${branchId}` : ''}`) });
  const k = d.data;
  const scope = user?.branchIds ? (cat.data?.branches?.map((b: any) => b.name).join(', ') ?? '') : branchId ? branches.data?.find((b: any) => String(b.id) === branchId)?.name : 'semua cabang';

  const rows = useMemo(() => {
    const all: any[] = k?.transactions ?? [];
    const s = q.trim().toLowerCase();
    return all.filter((t) => {
      if (filter === 'MASUK' && !(t.kind !== 'KELUAR')) return false;
      if (filter === 'KELUAR' && t.kind !== 'KELUAR') return false;
      if (filter === 'TAGIHAN' && !(t.kind === 'JUAL' && t.method === 'TAGIHAN' && !t.canceled)) return false;
      if (filter === 'MENUNGGU' && !(t.kind === 'KELUAR' && t.state === 'MENUNGGU')) return false;
      return !s || `${t.title} ${t.sub ?? ''} ${t.category ?? ''}`.toLowerCase().includes(s);
    });
  }, [k, filter, q]);
  const maxIn = Math.max(1, ...(k?.categories.masuk ?? []).map((c: any) => c.amount));
  const maxOut = Math.max(1, ...(k?.categories.keluar ?? []).map((c: any) => c.amount));
  const items = (cat.data?.itemCategories ?? []).filter((c: any) => c.isActive).flatMap((c: any) => c.items.filter((i: any) => i.isActive).map((i: any) => ({ ...i, icon: c.icon })));

  const actions = (
    <>
      <select className="input !h-11 !w-auto !rounded-full !pl-4" aria-label="Bulan" value={month} onChange={(e) => setMonth(e.target.value)}>
        {lastMonths(12).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
      </select>
      {!user?.branchIds && (
        <select className="input !h-11 !w-auto !rounded-full !pl-4" aria-label="Cabang" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          <option value="">Semua cabang</option>
          {branches.data?.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      {can(user, 'kas.ekspor') && <ExportMenu path="/kas/export" query={`month=${month}${branchId ? `&branchId=${branchId}` : ''}`} file={`kas-${month}`} />}
      {canInput && (
        <>
          <button className="btn-soft !h-11 hidden md:inline-flex text-danger-fg" onClick={() => setKeluar(true)}><Minus size={16} /> Catat pengeluaran</button>
          <button className="btn-primary !h-11 hidden md:inline-flex" onClick={() => setJual({})}><Plus size={16} /> Jual barang ke santri</button>
        </>
      )}
    </>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Kas" sub={`Penjualan barang & pengeluaran · ${k?.label ?? monthName(month)} · ${scope}`} actions={actions} />
      {user?.branchIds && <div className="-mt-3"><span className="pill bg-lilac-bg text-lilac-fg">🔒 {scope}</span></div>}

      {canInput && (
        <div className="grid grid-cols-2 gap-3 md:hidden">
          <button className="btn-primary !h-12" onClick={() => setJual({})}><Plus size={16} /> Jual barang</button>
          <button className="btn-secondary !h-12 text-danger-fg" onClick={() => setKeluar(true)}><Minus size={16} /> Pengeluaran</button>
        </div>
      )}

      {!k ? <p className="text-sm text-n-600">{d.error ? (d.error as any).message : 'Memuat…'}</p> : (
        <div className="grid xl:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
          <div className="space-y-5 min-w-0">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KasStat tone={3} icon={ArrowUpRight} value={k.summary.masuk} label="Pemasukan (penjualan barang)" onClick={() => setFilter('MASUK')} active={filter === 'MASUK'} />
              <KasStat tone={0} icon={ArrowDownLeft} value={k.summary.keluar} label="Pengeluaran" onClick={() => setFilter('KELUAR')} active={filter === 'KELUAR'} />
              <KasStat tone={2} icon={Package} value={k.summary.menungguNominal} label={`Menunggu persetujuan PJ (${k.summary.menunggu})`} onClick={() => setFilter('MENUNGGU')} active={filter === 'MENUNGGU'} />
              <KasStat tone={1} icon={Wallet} value={k.summary.belumDibayar} label="Barang belum dibayar (semua bulan)" />
            </div>

            <div className="xl:hidden"><Selisih k={k} /></div>

            {k.summary.menunggu > 0 && (
              <button className="w-full text-left" onClick={() => setFilter('MENUNGGU')}>
                <Alert kind="warning">{k.summary.menunggu} pengeluaran ({rupiah(k.summary.menungguNominal)}) menunggu persetujuan PJ{can(user, 'kas.setujui') ? ' — ketuk untuk memeriksa.' : '.'}</Alert>
              </button>
            )}

            <div className="grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5 items-start">
              <Card title="Masuk vs keluar · 6 bulan" action={<div className="flex gap-3 text-xs text-n-600"><span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-[#5fb38a]" />Masuk</span><span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-[#e46a5a]" />Keluar</span></div>}>
                <Chart data={k.chart} />
              </Card>
              <Card title="Per kategori">
                <div className="space-y-4">
                  {[['Pemasukan', k.categories.masuk, maxIn, '#5fb38a', 'text-success-fg'], ['Pengeluaran', k.categories.keluar, maxOut, '#e46a5a', 'text-danger-fg']].map(([title, list, max, color, cls]: any) => (
                    <div key={title}>
                      <div className={`text-xs font-extrabold uppercase tracking-wide mb-2 ${cls}`}>{title}</div>
                      {!list.length ? <div className="text-sm text-n-600">Belum ada.</div> : (
                        <div className="space-y-2">
                          {list.map((c: any) => (
                            <div key={c.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                              <span className="truncate">{c.label}</span>
                              <Bar value={c.amount} max={max} color={color} h={8} label={`${c.label} ${rupiah(c.amount)}`} />
                              <span className="num text-right">{rupiah(c.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <Card title="Transaksi" pad={false} action={<SearchBox value={q} onChange={setQ} placeholder="Cari keterangan atau santri" className="hidden sm:flex w-72" />}>
              <div className="px-4 md:px-5 pb-3 space-y-3">
                <SearchBox value={q} onChange={setQ} placeholder="Cari keterangan atau santri" className="sm:hidden" />
                <Chips label="Jenis transaksi" value={filter} onChange={setFilter} items={[
                  { value: 'ALL', label: 'Semua' }, { value: 'MASUK', label: 'Pemasukan' }, { value: 'KELUAR', label: 'Pengeluaran' }, { value: 'TAGIHAN', label: 'Ditagihkan ke wali' },
                  { value: 'MENUNGGU', label: 'Menunggu persetujuan PJ', n: k.summary.menunggu || undefined },
                ]} />
              </div>
              {!rows.length ? <Empty icon={ReceiptText} text="Belum ada transaksi." /> : (
                <>
                  <div className="hidden md:block scroll-x">
                    <table className="w-full">
                      <thead><tr><th className="th pl-5">Tanggal</th><th className="th">Keterangan</th><th className="th">Kategori</th><th className="th">Cara bayar</th><th className="th text-right pr-5">Nominal</th></tr></thead>
                      <tbody>
                        {rows.map((t) => {
                          const st = txStatus(t);
                          return (
                            <tr key={t.key} className={`${t.auto ? '' : 'cursor-pointer hover:bg-n-50'} ${t.canceled || ['DITOLAK', 'DIBATALKAN'].includes(t.state) ? 'opacity-60' : ''}`} onClick={() => !t.auto && setDetail(t)}>
                              <td className="td pl-5 whitespace-nowrap">{pendek(t.date)}</td>
                              <td className="td">
                                <div className="flex items-center gap-3 min-w-0">
                                  <span className={`w-8 h-8 shrink-0 rounded-xl flex items-center justify-center font-black ${t.kind === 'KELUAR' ? 'bg-danger-bg text-danger-fg' : 'bg-mint-bg text-mint-fg'}`}>{sign(t)}</span>
                                  <div className="min-w-0"><div className="font-semibold">{t.title}</div><div className="text-xs text-n-600">{t.sub}</div></div>
                                </div>
                              </td>
                              <td className="td"><span className={`pill ${t.kind === 'KELUAR' ? 'bg-danger-bg text-danger-fg' : t.kind === 'JUAL' ? 'bg-rose-bg text-rose-fg' : 'bg-mint-bg text-mint-fg'}`}>{t.category}{t.auto ? ' · otomatis' : ''}</span></td>
                              <td className="td text-sm"><div>{txMethod(t)}</div>{st && <div className={`text-xs ${st.tone}`}>{st.text}</div>}</td>
                              <td className={`td text-right pr-5 num whitespace-nowrap ${amountCls(t)}`}>{t.counted ? sign(t) : ''}{rupiah(t.amount)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="md:hidden px-4 pb-4 space-y-3">
                    {rows.map((t) => {
                      const st = txStatus(t);
                      const Tag: any = t.auto ? 'div' : 'button';
                      return (
                        <Tag key={t.key} onClick={() => !t.auto && setDetail(t)} className={`w-full text-left flex items-center gap-3 p-4 rounded-2xl bg-n-50 ${t.canceled || ['DITOLAK', 'DIBATALKAN'].includes(t.state) ? 'opacity-60' : ''}`}>
                          <span className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center font-black ${t.kind === 'KELUAR' ? 'bg-danger-bg text-danger-fg' : 'bg-mint-bg text-mint-fg'}`}>{sign(t)}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold line-clamp-2 break-words">{t.title}</div>
                            <div className={`text-xs line-clamp-2 ${st && st.tone !== 'text-n-600' ? st.tone : 'text-n-600'}`}>{[t.kind === 'KELUAR' ? t.category : t.sub, txMethod(t).toLowerCase(), st?.text ?? pendek(t.date)].filter(Boolean).join(' · ')}</div>
                          </div>
                          <span className={`num text-sm whitespace-nowrap ${amountCls(t)}`}>{t.counted ? sign(t) : ''}{rupiah(t.amount)}</span>
                        </Tag>
                      );
                    })}
                  </div>
                </>
              )}
            </Card>
          </div>

          <aside className="space-y-5 min-w-0">
            <div className="hidden xl:block"><Selisih k={k} /></div>

            <Card title="Barang belum dibayar" action={<span className="num text-danger-fg">{rupiah(k.summary.belumDibayar)}</span>}>
              {!k.unpaid.length ? <div className="text-sm text-n-600">Semua tagihan barang sudah lunas.</div> : (
                <div className="space-y-3">
                  {k.unpaid.slice(0, 6).map((u: any) => (
                    <button key={u.invoiceId} className="w-full flex items-start gap-3 text-left" onClick={() => can(user, 'bayar.input') && setPayFam({ familyId: u.familyId, preselect: [u.invoiceId] })}>
                      <Avatar name={u.fullName} size={36} />
                      <div className="flex-1 min-w-0"><div className="font-semibold text-sm truncate">{u.fullName}</div><div className="text-xs text-n-600 line-clamp-2">{u.label}</div></div>
                      <span className="num text-sm">{rupiah(u.amount)}</span>
                    </button>
                  ))}
                  <p className="text-xs text-n-600 pt-2 border-t border-n-100">Ditambahkan ke tagihan wali; ikut terkirim di pengingat menu Bayar.</p>
                </div>
              )}
            </Card>

            <Card title="Katalog barang" action={<button className="text-sm font-semibold text-brand-700 underline underline-offset-2" onClick={() => setKatalog(true)}>{canEdit ? 'Kelola' : 'Lihat'}</button>}>
              {!items.length ? <Empty text="Belum ada barang." action={canEdit && <button className="btn-secondary" onClick={() => setKatalog(true)}><Plus size={16} /> Tambah barang</button>} /> : (
                <div className="space-y-2.5">
                  {items.slice(0, 7).map((i: any) => (
                    <div key={i.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 text-sm">
                      <span className="truncate">{i.name}</span>
                      <span className={`text-xs ${i.stock <= i.lowStock ? 'text-danger-fg font-bold' : 'text-n-600'}`}>stok {i.stock}</span>
                      <span className="num">{rupiah(i.price)}</span>
                    </div>
                  ))}
                  {items.length > 7 && <button className="text-xs font-semibold text-brand-700" onClick={() => setKatalog(true)}>+{items.length - 7} barang lain</button>}
                </div>
              )}
            </Card>

            <div className="rounded-card bg-lilac-bg text-lilac-fg p-4 text-sm">Kas hanya mencatat penjualan barang dan pengeluaran. Uang SPP & daftar ulang ada di menu SPP, uang pendaftaran di menu Pendaftaran.</div>
          </aside>
        </div>
      )}

      {jual && <JualDrawer student={jual.student} onClose={() => setJual(null)} />}
      {keluar && <PengeluaranDrawer onClose={() => setKeluar(false)} />}
      {katalog && <KatalogDrawer onClose={() => setKatalog(false)} />}
      {detail && <TxDrawer t={detail} onClose={() => setDetail(null)} />}
      {payFam && <UploadDrawer familyId={payFam.familyId} preselect={payFam.preselect} onClose={() => setPayFam(null)} />}
    </div>
  );
}

// ---------------- Unggah foto (nota / bukti) ----------------
function FilePick({ file, orig, onPick, title, hint }: { file: File | null; orig: number; onPick: (f?: File) => void; title: string; hint: string }) {
  return (
    <label className="flex items-center gap-3 p-4 rounded-2xl border-2 border-dashed border-brand-300 bg-white cursor-pointer">
      <span className="w-12 h-12 rounded-xl bg-n-50 text-brand-700 flex items-center justify-center shrink-0"><Upload size={20} /></span>
      <span className="flex-1 min-w-0 text-sm">
        {file ? <><b className="block truncate">{file.name}</b><span className="text-mint-fg font-semibold text-xs">{sizeLabel(orig)} → {sizeLabel(file.size)} · ketuk untuk ganti</span></> : <><b className="block">{title}</b><span className="text-xs text-n-600">{hint}</span></>}
      </span>
      <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => onPick(e.target.files?.[0])} />
    </label>
  );
}
function useFile() {
  const [file, setFile] = useState<File | null>(null);
  const [orig, setOrig] = useState(0);
  const pick = async (f?: File) => { if (!f) return; setOrig(f.size); setFile(f.type === 'application/pdf' ? f : await compressImage(f)); };
  return { file, orig, pick };
}
const refreshKas = (qc: any) => { qc.invalidateQueries({ queryKey: ['kas'] }); qc.invalidateQueries({ queryKey: ['kas-catalog'] }); qc.invalidateQueries({ queryKey: ['kas-student'] }); qc.invalidateQueries({ queryKey: ['bayar'] }); };

// ---------------- Jual barang ----------------
/** Jual barang ke santri: stok berkurang di cabang santri. Dipakai juga di detail santri (tab Pembelian). */
export function JualDrawer({ student: initial, onClose }: { student?: any; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [student, setStudent] = useState<any>(initial ?? null);
  const [sq, setSq] = useState('');
  const [catId, setCatId] = useState('ALL');
  const [iq, setIq] = useState('');
  const [qty, setQty] = useState<Record<number, number>>({});
  const [method, setMethod] = useState<'TUNAI' | 'TRANSFER' | 'TAGIHAN'>('TUNAI');
  const [err, setErr] = useState('');
  const f = useFile();
  const found = useQuery({ queryKey: ['kas-students', sq], queryFn: () => get(`/kas/students?q=${encodeURIComponent(sq)}`), enabled: !student });
  const cat = useQuery({ queryKey: ['kas-catalog', String(student?.branchId ?? '')], queryFn: () => get(`/kas/catalog?branchId=${student.branchId}`), enabled: !!student });
  useEffect(() => setQty({}), [student?.id]);
  const cats = (cat.data?.itemCategories ?? []).filter((c: any) => c.isActive && c.items.some((i: any) => i.isActive));
  const all = cats.flatMap((c: any) => c.items.filter((i: any) => i.isActive).map((i: any) => ({ ...i, icon: c.icon })));
  const shown = all.filter((i: any) => (catId === 'ALL' || String(i.categoryId) === catId) && (!iq.trim() || i.name.toLowerCase().includes(iq.trim().toLowerCase())));
  const picked = all.filter((i: any) => qty[i.id] > 0);
  const total = picked.reduce((a: number, i: any) => a + i.price * qty[i.id], 0);
  const set = (i: any, n: number) => setQty({ ...qty, [i.id]: Math.max(0, Math.min(n, i.stock)) });
  const save = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('studentId', String(student.id));
      fd.append('method', method);
      fd.append('items', JSON.stringify(picked.map((i: any) => ({ itemId: i.id, qty: qty[i.id] }))));
      fd.append('soldAt', todayWIB());
      if (method === 'TRANSFER' && f.file) fd.append('file', f.file);
      return post('/kas/sales', fd);
    },
    onSuccess: () => {
      toast(method === 'TAGIHAN' ? 'Penjualan tersimpan · ditambahkan ke tagihan wali' : 'Penjualan tersimpan');
      refreshKas(qc);
      onClose();
    },
    onError: (e: any) => setErr(e.message),
  });
  const ready = student && picked.length && (method !== 'TRANSFER' || f.file) && (method !== 'TAGIHAN' || total > 0);
  return (
    <Drawer open onClose={onClose} title="Jual barang ke santri" sub="Tercatat sebagai pemasukan kas · stok berkurang otomatis"
      footer={
        <div className="space-y-3">
          {method === 'TAGIHAN' && <p className="text-xs text-n-600">Masuk ke menu Bayar sebagai tagihan barang; ikut di pesan WA dan halaman wali.</p>}
          {err && <Alert>{err}</Alert>}
          <div className="flex flex-col-reverse sm:flex-row gap-3">
            <button className="btn-soft sm:flex-1" onClick={onClose}>Batal</button>
            <button className="btn-primary sm:flex-[2]" disabled={!ready || save.isPending} onClick={() => { setErr(''); save.mutate(); }}>{save.isPending ? 'Menyimpan…' : `Simpan penjualan · ${rupiah(total)}`}</button>
          </div>
        </div>
      }>
      {!student ? (
        <div className="space-y-3">
          <SearchBox value={sq} onChange={setSq} placeholder="Cari nama santri atau wali" />
          <div className="space-y-2">
            {found.data?.map((s: any) => (
              <button key={s.id} className="w-full flex items-center gap-3 p-3 rounded-2xl bg-white shadow-soft text-left min-h-[56px]" onClick={() => setStudent(s)}>
                <Avatar name={s.fullName} size={40} />
                <div className="min-w-0"><div className="font-semibold truncate">{s.fullName}</div><div className="text-xs text-n-600 truncate">{s.branchName} · {s.className} · Kel. {s.familyName}</div></div>
              </button>
            ))}
            {found.data && !found.data.length && <p className="text-sm text-n-600 text-center py-6">Santri tidak ditemukan.</p>}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-white shadow-soft">
            <Avatar name={student.fullName} size={44} />
            <div className="flex-1 min-w-0"><div className="font-semibold truncate">{student.fullName}</div><div className="text-xs text-n-600 truncate">{student.branchName} · {student.className}{student.familyName ? ` · Kel. ${student.familyName}` : ''}</div></div>
            {!initial && <button className="btn-text !h-10 underline" onClick={() => setStudent(null)}>Ganti</button>}
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="label !mb-0">Pilih barang</div>
              <label className="flex items-center gap-2 h-10 px-3 rounded-full bg-white shadow-soft text-n-600 w-full sm:w-48"><Search size={15} /><input className="flex-1 min-w-0 bg-transparent outline-none text-sm text-n-900" placeholder="Cari barang" aria-label="Cari barang" value={iq} onChange={(e) => setIq(e.target.value)} /></label>
            </div>
            <Chips label="Kategori barang" value={catId} onChange={setCatId} items={[{ value: 'ALL', label: 'Semua' }, ...cats.map((c: any) => ({ value: String(c.id), label: c.name }))]} />
            {cat.isLoading ? <p className="text-sm text-n-600">Memuat katalog…</p> : !shown.length ? <Empty text={all.length ? 'Barang tidak ditemukan.' : 'Belum ada barang di katalog.'} /> : (
              <div className="grid sm:grid-cols-2 gap-3">
                {shown.map((i: any) => {
                  const Icon = ICON[i.icon] ?? Package, n = qty[i.id] ?? 0, out = i.stock <= 0;
                  return (
                    <div key={i.id} className={`p-3.5 rounded-2xl bg-white ${n ? 'ring-2 ring-brand-600' : 'shadow-soft'} ${out ? 'opacity-60' : ''}`}>
                      <div className="flex items-center gap-3">
                        <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${TONE[i.icon] ?? TONE.BOX}`}><Icon size={17} /></span>
                        <div className="min-w-0"><div className="text-sm font-semibold truncate">{i.name}</div>
                          <div className={`text-xs ${out ? 'text-danger-fg' : i.stock <= i.lowStock ? 'text-danger-fg' : 'text-n-600'}`}>stok {i.stock}{out ? ' · habis' : i.stock <= i.lowStock ? ' · hampir habis' : ''}</div></div>
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <span className="num text-sm">{rupiah(i.price)}</span>
                        <div className="flex items-center gap-2">
                          <button className="w-9 h-9 rounded-xl bg-n-50 font-black disabled:opacity-40" aria-label={`Kurangi ${i.name}`} disabled={!n} onClick={() => set(i, n - 1)}>−</button>
                          <span className="w-6 text-center font-black" aria-live="polite">{n}</span>
                          <button className="w-9 h-9 rounded-xl bg-brand-600 text-white font-black disabled:opacity-40" aria-label={`Tambah ${i.name}`} disabled={n >= i.stock} onClick={() => set(i, n + 1)}>+</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {picked.length > 0 && (
            <div className="card p-4 space-y-2 text-sm">
              <div className="font-semibold">Ringkasan</div>
              {picked.map((i: any) => <div key={i.id} className="flex justify-between gap-3"><span>{i.name} ×{qty[i.id]}</span><span>{rupiah(i.price * qty[i.id])}</span></div>)}
              <div className="flex justify-between items-center pt-2 border-t border-dashed border-n-300"><b>Total</b><span className="num text-xl text-brand-700">{rupiah(total)}</span></div>
            </div>
          )}

          <div>
            <div className="label">Cara bayar</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {([['TUNAI', 'Tunai', 'dibayar sekarang'], ['TRANSFER', 'Transfer', 'unggah bukti'], ['TAGIHAN', 'Tagihkan ke wali', 'masuk menu Bayar']] as const).map(([v, l, h]) => (
                <button key={v} type="button" aria-pressed={method === v} onClick={() => setMethod(v)} className={`text-left p-3 rounded-2xl min-h-[56px] ${method === v ? 'ring-2 ring-brand-600 bg-rose-bg/40' : 'bg-white shadow-soft'}`}>
                  <div className={`font-semibold ${method === v ? 'text-brand-700' : ''}`}>{l}</div><div className="text-xs text-n-600">{h}</div>
                </button>
              ))}
            </div>
          </div>
          {method === 'TRANSFER' && <FilePick {...f} onPick={f.pick} title="Pilih foto bukti transfer" hint="Wajib · JPG/PNG/PDF, maks. 5 MB" />}
          {!can(user, 'kas.setujui') && method === 'TUNAI' && <p className="text-xs text-n-600">Uang tunai diserahkan ke PJ saat setor kas.</p>}
        </>
      )}
    </Drawer>
  );
}

// ---------------- Catat pengeluaran ----------------
function PengeluaranDrawer({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const cat = useQuery({ queryKey: ['kas-catalog', ''], queryFn: () => get('/kas/catalog') });
  const branches = cat.data?.branches ?? [];
  const [form, setForm] = useState({ categoryId: '', amount: '', description: '', spentAt: todayWIB(), method: 'TUNAI', branchId: '' });
  const [restock, setRestock] = useState<{ itemId: string; qty: string }[]>([]);
  const [err, setErr] = useState('');
  const f = useFile();
  useEffect(() => { if (branches.length === 1 && !form.branchId) setForm((x) => ({ ...x, branchId: String(branches[0].id) })); }, [branches.length]);
  const ecats = (cat.data?.expenseCategories ?? []).filter((c: any) => c.isActive);
  const items = (cat.data?.itemCategories ?? []).filter((c: any) => c.isActive).flatMap((c: any) => c.items.filter((i: any) => i.isActive));
  const direct = can(user, 'kas.setujui');
  const amount = Number(form.amount) || 0;
  const save = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, String(v)));
      fd.append('restock', JSON.stringify(restock.filter((r) => r.itemId && Number(r.qty) > 0).map((r) => ({ itemId: Number(r.itemId), qty: Number(r.qty) }))));
      if (f.file) fd.append('file', f.file);
      return post('/kas/expenses', fd);
    },
    onSuccess: (r: any) => { toast(r.state === 'MENUNGGU' ? 'Pengeluaran tersimpan · menunggu persetujuan PJ' : 'Pengeluaran tersimpan'); refreshKas(qc); onClose(); },
    onError: (e: any) => setErr(e.message),
  });
  const set = (k: string) => (e: any) => setForm({ ...form, [k]: e.target.value });
  const ready = form.categoryId && amount > 0 && form.description.trim().length >= 3 && form.branchId;
  return (
    <Drawer open onClose={onClose} title="Catat pengeluaran" sub={branches.length === 1 ? `Kas cabang ${branches[0].name}` : 'Kas cabang'}
      footer={
        <div className="space-y-3">
          {err && <Alert>{err}</Alert>}
          <button className="btn-primary w-full !h-12" disabled={!ready || save.isPending} onClick={() => { setErr(''); save.mutate(); }}>{save.isPending ? 'Menyimpan…' : `Simpan pengeluaran · ${rupiah(amount)}`}</button>
        </div>
      }>
      <div>
        <div className="label">Kategori</div>
        <div className="flex flex-wrap gap-2">
          {ecats.map((c: any) => <button key={c.id} type="button" aria-pressed={form.categoryId === String(c.id)} className={form.categoryId === String(c.id) ? 'chip-on' : 'chip-off'} onClick={() => setForm({ ...form, categoryId: String(c.id) })}>{c.name}</button>)}
        </div>
      </div>
      <div className="card p-4 space-y-4">
        {branches.length > 1 && (
          <Field label="Cabang">
            <select className="input" value={form.branchId} onChange={set('branchId')}><option value="">Pilih cabang</option>{branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </Field>
        )}
        <Field label="Nominal">
          <div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-n-600 text-sm">Rp</span><input className="input !pl-11 num text-xl" type="number" inputMode="numeric" min={1} value={form.amount} onChange={set('amount')} placeholder="0" /></div>
        </Field>
        <Field label="Keterangan"><input className="input" value={form.description} onChange={set('description')} maxLength={200} placeholder="mis. Spidol & kertas absen" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tanggal"><input className="input" type="date" max={todayWIB()} value={form.spentAt} onChange={set('spentAt')} /></Field>
          <Field label="Dibayar"><select className="input" value={form.method} onChange={set('method')}><option value="TUNAI">Tunai</option><option value="TRANSFER">Transfer</option></select></Field>
        </div>
      </div>
      {items.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between"><div className="label !mb-0">Restock barang (opsional)</div><button className="btn-text !h-9" onClick={() => setRestock([...restock, { itemId: '', qty: '1' }])}><Plus size={14} /> Barang</button></div>
          {restock.map((r, k) => (
            <div key={k} className="grid grid-cols-[minmax(0,1fr)_80px_auto] gap-2">
              <select className="input" aria-label="Barang restock" value={r.itemId} onChange={(e) => setRestock(restock.map((x, j) => (j === k ? { ...x, itemId: e.target.value } : x)))}><option value="">Pilih barang</option>{items.map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
              <input className="input" type="number" min={1} aria-label="Jumlah" value={r.qty} onChange={(e) => setRestock(restock.map((x, j) => (j === k ? { ...x, qty: e.target.value } : x)))} />
              <button className="icon-btn" aria-label="Hapus baris" onClick={() => setRestock(restock.filter((_, j) => j !== k))}>×</button>
            </div>
          ))}
          {restock.length > 0 && <p className="text-xs text-n-600">Stok cabang bertambah {direct ? 'saat disimpan' : 'setelah disetujui PJ'}.</p>}
        </div>
      )}
      <FilePick {...f} onPick={f.pick} title="Foto nota (opsional)" hint="JPG/PNG/PDF, maks. 5 MB" />
      {!direct && <Alert kind="warning">Pengeluaran dari ustadzah menunggu persetujuan PJ sebelum masuk laporan kas.</Alert>}
    </Drawer>
  );
}

// ---------------- Detail transaksi (setujui / tolak / batal) ----------------
function TxDrawer({ t, onClose }: { t: any; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState<string | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const approver = can(user, 'kas.setujui');
  const isExp = t.kind === 'KELUAR';
  const act = useMutation({
    mutationFn: (a: 'approve' | 'decline' | 'cancel') =>
      a === 'approve' ? post(`/kas/expenses/${t.id}/approve`) : a === 'decline' ? post(`/kas/expenses/${t.id}/decline`, { reason }) : post(`/kas/sales/${t.id}/cancel`, { reason }),
    onSuccess: (_: any, a) => { toast(a === 'approve' ? 'Pengeluaran disetujui' : a === 'cancel' ? 'Penjualan dibatalkan' : t.state === 'MENUNGGU' ? 'Pengeluaran ditolak' : 'Pengeluaran dibatalkan'); refreshKas(qc); onClose(); },
    onError: (e: any) => toast(e.message, 'danger'),
  });
  const showProof = async () => { const b = await get(`/kas/${isExp ? 'expenses' : 'sales'}/${t.id}/proof`); setImg(URL.createObjectURL(b as any)); };
  const st = isExp ? t.state : t.canceled ? 'DIBATALKAN' : t.method === 'TAGIHAN' ? (t.invoiceStatus ?? 'BELUM') : 'LUNAS';
  const canDecline = approver && isExp && ['MENUNGGU', 'DISETUJUI'].includes(t.state);
  const canCancel = approver && !isExp && !t.canceled;
  return (
    <Drawer open onClose={onClose} title={t.title} sub={t.sub} badge={<Badge status={st} />}
      footer={(canDecline || canCancel) && (
        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button className="btn-soft sm:flex-1 text-danger-fg" onClick={() => setReason('')}>{isExp ? (t.state === 'MENUNGGU' ? 'Tolak' : 'Batalkan') : 'Batalkan penjualan'}</button>
          {isExp && t.state === 'MENUNGGU' && <button className="btn-primary sm:flex-1" disabled={act.isPending} onClick={() => act.mutate('approve')}>Setujui</button>}
        </div>
      )}>
      <div className="card p-5 text-center"><div className="text-sm text-n-600">{isExp ? 'Pengeluaran' : 'Penjualan barang'}</div><div className={`num text-3xl mt-1 ${isExp ? 'text-danger-fg' : 'text-success-fg'}`}>{rupiah(t.amount)}</div></div>
      <div className="card px-4">
        {([
          ['Tanggal', tgl(t.date)], ['Kategori', t.category], ['Cara bayar', txMethod(t)], ['Cabang', t.branchName],
          ...(t.restock ? [['Restock', t.restock]] : []), ['Dicatat oleh', t.createdBy ?? '-'], ...(t.decidedBy ? [[t.state === 'DISETUJUI' ? 'Disetujui oleh' : 'Diputuskan oleh', t.decidedBy]] : []),
          ...(t.reason || t.cancelReason ? [['Alasan', t.reason ?? t.cancelReason]] : []),
        ] as [string, string][]).map(([k, v], i, arr) => <div key={k} className={`flex justify-between gap-4 py-3 text-sm ${i < arr.length - 1 ? 'border-b border-n-100' : ''}`}><span className="text-n-600">{k}</span><b className="font-semibold text-right">{v}</b></div>)}
      </div>
      {t.method === 'TAGIHAN' && !t.canceled && <Alert kind="info">Tagihan barang ada di menu Bayar keluarga ini{t.invoiceStatus === 'LUNAS' ? ' dan sudah lunas.' : '; ikut dalam pesan WA tagihan.'}</Alert>}
      {t.hasProof && (img ? <img src={img} alt="Foto nota / bukti" className="w-full rounded-2xl" /> : <button className="btn-secondary w-full" onClick={showProof}><FileText size={16} /> Lihat {isExp ? 'nota' : 'bukti transfer'}</button>)}
      <Dialog open={reason !== null} onClose={() => setReason(null)} title={isExp ? (t.state === 'MENUNGGU' ? 'Tolak pengeluaran' : 'Batalkan pengeluaran') : 'Batalkan penjualan'}>
        <div className="space-y-4">
          <p className="text-sm text-n-700">{isExp ? (t.state === 'DISETUJUI' ? 'Pengeluaran keluar dari laporan kas; stok restock ditarik kembali.' : 'Pengeluaran tidak masuk laporan kas.') : 'Stok barang kembali; tagihan barang di menu Bayar dibatalkan.'} Data tetap tersimpan di riwayat.</p>
          <Field label="Alasan"><textarea className="input !h-auto py-3" rows={3} value={reason ?? ''} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="flex gap-3"><button className="btn-soft flex-1" onClick={() => setReason(null)}>Kembali</button><button className="btn-danger flex-1" disabled={(reason ?? '').trim().length < 3 || act.isPending} onClick={() => act.mutate(isExp ? 'decline' : 'cancel')}>Simpan</button></div>
        </div>
      </Dialog>
    </Drawer>
  );
}

// ---------------- Kelola katalog & kategori ----------------
function KatalogDrawer({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const edit = can(user, 'kas.edit');
  const [tab, setTab] = useState<'barang' | 'keluar'>('barang');
  const [catDlg, setCatDlg] = useState<any>(null);
  const [itemDlg, setItemDlg] = useState<any>(null);
  const [stockDlg, setStockDlg] = useState<any>(null);
  const [ecatDlg, setEcatDlg] = useState<any>(null);
  const cat = useQuery({ queryKey: ['kas-catalog', ''], queryFn: () => get('/kas/catalog') });
  const d = cat.data;
  return (
    <Drawer open onClose={onClose} title={edit ? 'Kelola katalog' : 'Katalog barang'} sub="Kategori barang, jenis barang & stok per cabang, kategori pengeluaran">
      <Segmented label="Bagian katalog" value={tab} onChange={setTab} items={[{ value: 'barang', label: 'Barang' }, { value: 'keluar', label: 'Kategori pengeluaran' }]} />
      {!d ? <p className="text-sm text-n-600">Memuat…</p> : tab === 'barang' ? (
        <div className="space-y-4">
          {edit && <button className="btn-secondary w-full" onClick={() => setCatDlg('new')}><Plus size={16} /> Kategori barang</button>}
          {d.itemCategories.map((c: any) => {
            const Icon = ICON[c.icon] ?? Package;
            return (
              <section key={c.id} className={`card p-4 space-y-3 ${c.isActive ? '' : 'opacity-60'}`}>
                <div className="flex items-center gap-3">
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${TONE[c.icon] ?? TONE.BOX}`}><Icon size={18} /></span>
                  <div className="flex-1 min-w-0"><div className="font-bold truncate">{c.name}</div><div className="text-xs text-n-600">{c.items.filter((i: any) => i.isActive).length} barang{c.isActive ? '' : ' · nonaktif'}</div></div>
                  {edit && <button className="btn-text !h-10" onClick={() => setCatDlg(c)}>Ubah</button>}
                </div>
                <div className="divide-y divide-n-100">
                  {c.items.map((i: any) => (
                    <div key={i.id} className={`flex items-center gap-3 py-2.5 ${i.isActive ? '' : 'opacity-60'}`}>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{i.name}{!i.isActive && ' · nonaktif'}</div>
                        <div className="text-xs text-n-600 truncate">{rupiah(i.price)} · {i.stocks.map((s: any) => <span key={s.branchId} className={s.qty <= i.lowStock ? 'text-danger-fg' : ''}>{d.branches.length > 1 ? `${s.branchName} ` : 'stok '}{s.qty}{' '}</span>)}</div>
                      </div>
                      {edit && <><button className="btn-text !h-10 !px-2" onClick={() => setStockDlg(i)}>Stok</button><button className="btn-text !h-10 !px-2" onClick={() => setItemDlg(i)}>Ubah</button></>}
                    </div>
                  ))}
                  {!c.items.length && <p className="text-sm text-n-600 py-2">Belum ada barang.</p>}
                </div>
                {edit && c.isActive && <button className="btn-soft w-full !h-11" onClick={() => setItemDlg({ categoryId: c.id })}><Plus size={15} /> Barang di {c.name}</button>}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {edit && <button className="btn-secondary w-full" onClick={() => setEcatDlg('new')}><Plus size={16} /> Kategori pengeluaran</button>}
          <div className="card px-4 divide-y divide-n-100">
            {d.expenseCategories.map((c: any) => (
              <div key={c.id} className={`flex items-center gap-3 py-3 ${c.isActive ? '' : 'opacity-60'}`}>
                <div className="flex-1 min-w-0"><div className="font-semibold text-sm">{c.name}</div><div className="text-xs text-n-600">dipakai {c.used} pengeluaran{c.isActive ? '' : ' · nonaktif'}</div></div>
                {edit && <button className="btn-text !h-10" onClick={() => setEcatDlg(c)}>Ubah</button>}
              </div>
            ))}
          </div>
        </div>
      )}
      {catDlg && <NameDialog kind="item" x={catDlg} icons={d.icons} onClose={() => setCatDlg(null)} />}
      {ecatDlg && <NameDialog kind="expense" x={ecatDlg} onClose={() => setEcatDlg(null)} />}
      {itemDlg && <ItemDialog x={itemDlg} cats={d.itemCategories.filter((c: any) => c.isActive || c.id === itemDlg.categoryId)} onClose={() => setItemDlg(null)} />}
      {stockDlg && <StockDialog item={stockDlg} branches={d.branches} onClose={() => setStockDlg(null)} />}
    </Drawer>
  );
}

/** Tambah / ubah / nonaktifkan kategori (barang atau pengeluaran). Tidak dihapus permanen. */
function NameDialog({ kind, x, icons, onClose }: { kind: 'item' | 'expense'; x: any; icons?: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const isNew = x === 'new';
  const [name, setName] = useState(isNew ? '' : x.name);
  const [icon, setIcon] = useState(isNew ? 'BOX' : x.icon);
  const [active, setActive] = useState(isNew ? true : x.isActive);
  const [err, setErr] = useState('');
  const base = kind === 'item' ? '/kas/item-categories' : '/kas/expense-categories';
  const save = useMutation({
    mutationFn: () => { const body: any = { name: name.trim(), ...(kind === 'item' ? { icon } : {}), ...(isNew ? {} : { isActive: active }) }; return isNew ? post(base, body) : patch(`${base}/${x.id}`, body); },
    onSuccess: () => { toast('Kategori tersimpan'); qc.invalidateQueries({ queryKey: ['kas-catalog'] }); qc.invalidateQueries({ queryKey: ['kas'] }); onClose(); },
    onError: (e: any) => setErr(e.details?.join(', ') ?? e.message),
  });
  return (
    <Dialog open onClose={onClose} title={`${isNew ? 'Tambah' : 'Ubah'} kategori ${kind === 'item' ? 'barang' : 'pengeluaran'}`}>
      <div className="space-y-4">
        {err && <Alert>{err}</Alert>}
        <Field label="Nama kategori"><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={kind === 'item' ? 'mis. Seragam' : 'mis. Transportasi'} /></Field>
        {kind === 'item' && (
          <div>
            <div className="label">Ikon</div>
            <div className="flex flex-wrap gap-2">
              {(icons ?? []).map((k) => { const I = ICON[k] ?? Package; return <button key={k} type="button" aria-pressed={icon === k} onClick={() => setIcon(k)} className={`flex items-center gap-2 h-11 px-3 rounded-2xl ${icon === k ? 'ring-2 ring-brand-600 bg-white' : 'bg-white shadow-soft'}`}><span className={`w-7 h-7 rounded-lg flex items-center justify-center ${TONE[k]}`}><I size={15} /></span><span className="text-sm">{ICON_LABEL[k]}</span></button>; })}
            </div>
          </div>
        )}
        {!isNew && (
          <label className="flex items-start gap-3 p-3.5 rounded-2xl bg-white shadow-soft text-sm">
            <input type="checkbox" className="w-5 h-5 mt-0.5 accent-brand-600" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span><b>Aktif</b> — kategori nonaktif tidak muncul lagi di pilihan{kind === 'item' ? ' (barangnya tidak bisa dijual)' : ''}, tetapi riwayat transaksi tetap tersimpan.</span>
          </label>
        )}
        <div className="flex gap-3"><button className="btn-soft flex-1" onClick={onClose}>Batal</button><button className="btn-primary flex-1" disabled={name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>Simpan</button></div>
      </div>
    </Dialog>
  );
}

function ItemDialog({ x, cats, onClose }: { x: any; cats: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const isNew = !x.id;
  const [f, setF] = useState({ categoryId: String(x.categoryId ?? ''), name: x.name ?? '', price: String(x.price ?? ''), lowStock: String(x.lowStock ?? 3), isActive: x.isActive ?? true });
  const [err, setErr] = useState('');
  const save = useMutation({
    mutationFn: () => { const body: any = { categoryId: Number(f.categoryId), name: f.name.trim(), price: Number(f.price), lowStock: Number(f.lowStock) }; if (!isNew) body.isActive = f.isActive; return isNew ? post('/kas/items', body) : patch(`/kas/items/${x.id}`, body); },
    onSuccess: () => { toast(isNew ? 'Barang ditambahkan · isi stok awal lewat tombol Stok' : 'Barang tersimpan'); qc.invalidateQueries({ queryKey: ['kas-catalog'] }); onClose(); },
    onError: (e: any) => setErr(e.details?.join(', ') ?? e.message),
  });
  return (
    <Dialog open onClose={onClose} title={isNew ? 'Tambah barang' : `Ubah ${x.name}`}>
      <div className="space-y-4">
        {err && <Alert>{err}</Alert>}
        <Field label="Kategori"><select className="input" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Nama barang"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} placeholder="mis. Iqro jilid 1" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Harga (Rp)" hint={f.price ? rupiah(Number(f.price)) : undefined}><input className="input" type="number" inputMode="numeric" min={0} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <Field label="Tanda hampir habis" hint="stok ≤ angka ini"><input className="input" type="number" inputMode="numeric" min={0} value={f.lowStock} onChange={(e) => setF({ ...f, lowStock: e.target.value })} /></Field>
        </div>
        {!isNew && (
          <label className="flex items-start gap-3 p-3.5 rounded-2xl bg-white shadow-soft text-sm">
            <input type="checkbox" className="w-5 h-5 mt-0.5 accent-brand-600" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
            <span><b>Aktif</b> — barang nonaktif tidak bisa dijual lagi; riwayat penjualan tetap tersimpan.</span>
          </label>
        )}
        {!isNew && <Alert kind="info">Harga baru berlaku untuk penjualan berikutnya. Penjualan lama tetap memakai harga saat itu.</Alert>}
        <div className="flex gap-3"><button className="btn-soft flex-1" onClick={onClose}>Batal</button><button className="btn-primary flex-1" disabled={!f.categoryId || f.name.trim().length < 2 || f.price === '' || save.isPending} onClick={() => save.mutate()}>Simpan</button></div>
      </div>
    </Dialog>
  );
}

/** Stok awal / koreksi per cabang (PJ). Restock rutin sebaiknya lewat Catat pengeluaran agar biayanya tercatat. */
function StockDialog({ item, branches, onClose }: { item: any; branches: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [branchId, setBranchId] = useState(String(branches[0]?.id ?? ''));
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const hist = useQuery({ queryKey: ['kas-stock', item.id], queryFn: () => get(`/kas/items/${item.id}/stock`) });
  const cur = item.stocks.find((s: any) => String(s.branchId) === branchId)?.qty ?? 0;
  const n = Number(delta) || 0;
  const save = useMutation({
    mutationFn: () => post(`/kas/items/${item.id}/stock`, { branchId: Number(branchId), delta: n, note: note.trim() }),
    onSuccess: () => { toast('Stok diperbarui'); qc.invalidateQueries({ queryKey: ['kas-catalog'] }); qc.invalidateQueries({ queryKey: ['kas-stock', item.id] }); onClose(); },
    onError: (e: any) => setErr(e.details?.join(', ') ?? e.message),
  });
  const KIND: Record<string, string> = { RESTOCK: 'Restock', JUAL: 'Terjual', BATAL_JUAL: 'Batal jual', BATAL_RESTOCK: 'Batal restock', KOREKSI: 'Koreksi' };
  return (
    <Dialog open onClose={onClose} title={`Stok ${item.name}`}>
      <div className="space-y-4">
        {err && <Alert>{err}</Alert>}
        {branches.length > 1 && <Field label="Cabang"><select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
        <Field label="Tambah / kurangi" hint={`Stok sekarang ${cur} → ${cur + n}. Pakai angka minus untuk mengurangi (rusak/hilang).`}><input className="input" type="number" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="mis. 20 atau -2" /></Field>
        <Field label="Keterangan"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="mis. Stok awal, hasil hitung ulang" /></Field>
        <div className="flex gap-3"><button className="btn-soft flex-1" onClick={onClose}>Batal</button><button className="btn-primary flex-1" disabled={!n || cur + n < 0 || note.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>Simpan stok</button></div>
        {hist.data?.length > 0 && (
          <div>
            <div className="label">Riwayat terakhir</div>
            <div className="card px-4 divide-y divide-n-100 max-h-56 overflow-auto">
              {hist.data.slice(0, 12).map((h: any) => (
                <div key={h.id} className="flex justify-between gap-3 py-2 text-xs">
                  <span className="min-w-0"><b>{KIND[h.kind] ?? h.kind}</b> · {h.branchName}{h.note ? ` · ${h.note}` : ''}<span className="block text-n-600">{tgl(h.createdAt)}{h.by ? ` · ${h.by}` : ''}</span></span>
                  <span className={`num ${h.delta < 0 ? 'text-danger-fg' : 'text-success-fg'}`}>{h.delta > 0 ? '+' : ''}{h.delta}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** Tab Pembelian di detail santri */
export function PembelianTab({ student }: { student: any }) {
  const { user } = useAuth();
  const [jual, setJual] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const q = useQuery({ queryKey: ['kas-student', student.id], queryFn: () => get(`/kas/students/${student.id}/sales`) });
  if (!q.data) return <p className="text-sm text-n-600">Memuat…</p>;
  const d = q.data;
  return (
    <div className="space-y-3 max-w-2xl">
      <div className="card p-4 flex items-center justify-between gap-3">
        <div><div className="text-xs text-n-600">Total pembelian tahun ini</div><div className="num text-2xl">{rupiah(d.totalYear)}</div></div>
        {d.rows.length > 0 && (d.unpaid ? <span className="pill bg-butter-bg text-butter-fg">{d.unpaid} belum dibayar</span> : <span className="pill bg-mint-bg text-mint-fg">Semua lunas</span>)}
      </div>
      {!d.rows.length ? <Card><Empty icon={Package} text="Belum ada pembelian barang." /></Card> : d.rows.map((r: any) => (
        <button key={r.id} onClick={() => setDetail({ ...r, kind: 'JUAL', title: r.items, sub: `${r.fullName} · ${r.branchName}`, amount: r.total, category: 'Penjualan barang' })} className={`card p-4 w-full text-left ${r.canceled ? 'opacity-60' : ''}`}>
          <div className="flex justify-between gap-3"><span className="font-semibold">{r.items}</span><span className="num whitespace-nowrap">{rupiah(r.total)}</span></div>
          <div className="flex justify-between gap-3 mt-1 text-xs">
            <span className="text-n-600">{tgl(r.date)}{r.createdBy ? ` · ${r.createdBy}` : ''}</span>
            <span className={r.canceled ? 'text-n-600' : r.method === 'TAGIHAN' && r.invoiceStatus !== 'LUNAS' ? 'text-warning-fg' : 'text-success-fg'}>
              {r.canceled ? 'Dibatalkan' : r.method === 'TAGIHAN' ? `Ditagihkan · ${r.invoiceStatus === 'LUNAS' ? 'lunas' : r.invoiceStatus === 'MENUNGGU' ? 'diperiksa' : 'belum dibayar'}` : METHOD[r.method]}
            </span>
          </div>
        </button>
      ))}
      {can(user, 'kas.input') && student.status !== 'KELUAR' && <button className="btn-soft w-full !h-12" onClick={() => setJual(true)}><Plus size={16} /> Jual barang ke {student.nickname || student.fullName.split(' ')[0]}</button>}
      {jual && <JualDrawer student={{ id: student.id, fullName: student.fullName, branchId: student.branchId, branchName: student.branchName, className: student.className }} onClose={() => setJual(false)} />}
      {detail && <TxDrawer t={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
