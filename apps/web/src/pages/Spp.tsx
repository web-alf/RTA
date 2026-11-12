import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard } from 'lucide-react';
import { can, get, monthWIB, post, rupiah } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { ExportMenu } from '../components/ExportMenu';
import { Badge, Bar, Card, Chips, COLOR, Dialog, Empty, PageHeader, Ring, SearchBox } from '../components/ui';

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const CELL: Record<string, string> = { LUNAS: COLOR.lunas, MENUNGGU: COLOR.menunggu, BELUM: COLOR.belum, TUNGGAKAN: COLOR.tunggakan, TIDAK_DITAGIH: '#f1eef0' };
const WORD: Record<string, string> = { LUNAS: 'lunas', MENUNGGU: 'menunggu verifikasi', BELUM: 'belum bayar', TUNGGAKAN: 'tunggakan', TIDAK_DITAGIH: 'tidak ditagih' };
const COLORS = ['#ad1d8e', '#8b74d9', '#5fb38a', '#f2c766'];

export default function Spp() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [month, setMonth] = useState(monthWIB());
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState<null | 'spp' | 'du'>(null);
  const sum = useQuery({ queryKey: ['spp-sum', month], queryFn: () => get(`/spp/summary?month=${month}`) });
  const list = useQuery({ queryKey: ['spp-list', month, q], queryFn: () => get(`/spp/students?month=${month}${q ? `&q=${encodeURIComponent(q)}` : ''}`) });
  const gen = useMutation({
    mutationFn: (k: 'spp' | 'du') => post(k === 'spp' ? `/spp/generate?month=${month}` : '/spp/generate-reregistration'),
    onSuccess: (d: any) => {
      toast(`${d.created} tagihan dibuat`);
      setConfirm(null);
      qc.invalidateQueries();
    },
    onError: (e: any) => { toast(e.message, 'danger'); setConfirm(null); },
  });
  const cfg = useQuery({ queryKey: ['settings'], queryFn: () => get('/settings'), enabled: can(user, 'pengaturan.lihat') });
  const duFee = cfg.data?.values?.reregistrationFee;
  const s = sum.data;
  const c = s?.counts ?? {};
  const all: any[] = list.data?.rows ?? [];
  const n = (st: string) => all.filter((r) => r.status === st).length;
  const rows = all.filter((r: any) => !status || r.status === status);
  const months: string[] = list.data?.months ?? [];
  const mLetter = (m: string) => BULAN[Number(m.slice(5, 7)) - 1][0];
  const mName = (m: string) => `${BULAN_PANJANG[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  const pct = s?.total ? Math.round((c.LUNAS / s.total) * 100) : 0;

  const History = ({ r }: { r: any }) => (
    <div role="img" aria-label={`${months.length} bulan terakhir: ${r.hist.map((h: any) => `${mName(h.month)} ${WORD[h.status]}`).join(', ')}`} className="flex gap-1">
      {r.hist.map((h: any) => (
        <span key={h.month} title={`${mName(h.month)}: ${WORD[h.status]}`} className="w-5 h-5 rounded-md" style={{ background: CELL[h.status] }} />
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="SPP"
        sub={`Rekap siapa sudah dan belum bayar · ${s?.label ?? ''}`}
        actions={
          <>
            <input type="month" className="input !h-10 !w-auto !rounded-full" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Pilih bulan" />
            {can(user, 'spp.ekspor') && <ExportMenu path="/spp/export" query={`month=${month}`} file={`spp-${month}`} />}
            {can(user, 'spp.input') && (
              <>
                <button className="btn-secondary" onClick={() => setConfirm('spp')}>
                  Buat tagihan SPP
                </button>
                <button className="btn-secondary" onClick={() => setConfirm('du')}>
                  Tagih daftar ulang
                </button>
              </>
            )}
            {can(user, 'bayar.lihat') && (
              <Link to="/bayar" className="btn-primary">
                Tagih di menu Bayar ›
              </Link>
            )}
          </>
        }
      />

      {s && (
        <div className={`grid gap-4 ${s.branches.length > 1 ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]' : ''}`}>
          <Card className="flex items-center gap-5">
            <Ring
              size={128}
              label={`${c.LUNAS} dari ${s.total} santri lunas`}
              center={`${pct}%`}
              sub="santri lunas"
              segments={[
                { value: c.LUNAS, color: COLOR.lunas },
                { value: c.MENUNGGU, color: COLOR.menunggu },
                { value: c.BELUM, color: COLOR.belum },
                { value: c.TUNGGAKAN, color: COLOR.tunggakan },
              ]}
            />
            <div className={`flex-1 grid grid-cols-2 gap-x-4 gap-y-3 text-xs ${s.branches.length > 1 ? '' : 'md:grid-cols-4'}`}>
              {[
                ['Lunas', c.LUNAS, COLOR.lunas],
                ['Menunggu', c.MENUNGGU, COLOR.menunggu],
                ['Belum bayar', c.BELUM, COLOR.belum],
                ['Keluarga tunggakan', s.money.keluargaTunggakan, COLOR.tunggakan],
              ].map(([l, n, col]: any) => (
                <div key={l}>
                  <div className="flex items-center gap-1.5 text-n-600">
                    <span className="w-2 h-2 rounded-full" style={{ background: col }} />
                    {l}
                  </div>
                  <b className="num text-lg">{n}</b>
                </div>
              ))}
              <div className={`col-span-2 text-n-600 ${s.branches.length > 1 ? '' : 'md:col-span-4'}`}>
                Terbayar <b className="text-n-900">{rupiah(s.money.terbayar)}</b> dari {rupiah(s.money.tagihan)}
              </div>
            </div>
          </Card>
          {s.branches.length > 1 && (
            <Card title="Lunas per cabang">
              <div className="space-y-3">
                {s.branches.map((b: any, i: number) => (
                  <div key={b.id} className="flex items-center gap-3 text-sm">
                    <span className="w-24 shrink-0">{b.name}</span>
                    <Bar value={b.lunas} max={b.total} color={COLORS[i % 4]} h={12} label={`${b.name}: ${b.lunas} dari ${b.total} lunas`} />
                    <b className="num w-16 text-right shrink-0">
                      {b.lunas}/{b.total}
                    </b>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {s && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            ['Tagihan SPP bulan ini', s.money.tagihan, 'bg-n-50 text-n-700'],
            ['Terbayar (terverifikasi)', s.money.terbayar, 'bg-mint-bg text-mint-fg'],
            ['Menunggu verifikasi', s.money.menunggu, 'bg-lilac-bg text-lilac-fg'],
            ['Tunggakan (semua bulan)', s.money.tunggakan, 'bg-danger-bg text-danger-fg'],
          ].map(([l, v, cls]: any) => (
            <div key={l} className={`rounded-card p-4 min-w-0 ${cls}`}>
              <div className="num text-lg sm:text-xl text-n-900 whitespace-nowrap">{rupiah(v)}</div>
              <div className="text-xs mt-1">{l}</div>
            </div>
          ))}
          {s.daftarUlang && (
            <div className="rounded-card p-4 min-w-0 bg-butter-bg text-butter-fg col-span-2 lg:col-span-1">
              <div className="num text-lg sm:text-xl text-n-900 whitespace-nowrap">{rupiah(s.daftarUlang.terbayar)}</div>
              <div className="text-xs mt-1">Daftar ulang {s.daftarUlang.label}: dari {rupiah(s.daftarUlang.tagihan)} · {s.daftarUlang.lunas}/{s.daftarUlang.santri} lunas</div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <SearchBox value={q} onChange={setQ} placeholder="Cari santri atau wali" className="md:w-80" />
        <Chips
          label="Filter status bayar"
          value={status}
          onChange={setStatus}
          items={[
            { value: '', label: 'Semua', n: all.length },
            { value: 'LUNAS', label: 'Lunas', n: n('LUNAS') },
            { value: 'MENUNGGU', label: 'Menunggu', n: n('MENUNGGU') },
            { value: 'BELUM', label: 'Belum bayar', n: n('BELUM') },
            { value: 'TUNGGAKAN', label: 'Tunggakan', n: n('TUNGGAKAN') },
            { value: 'TIDAK_DITAGIH', label: 'Tidak ditagih', n: n('TIDAK_DITAGIH') },
          ]}
        />
      </div>

      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty icon={CreditCard} text={list.isLoading ? 'Memuat…' : 'Tidak ada data untuk filter ini.'} />
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead>
                  <tr>
                    <th className="th pl-5 pt-5">Santri</th>
                    <th className="th pt-5">Wali</th>
                    <th className="th pt-5">
                      <div>{months.length} bulan terakhir</div>
                      <div className="flex gap-1 mt-1" aria-hidden>
                        {months.map((m) => (
                          <span key={m} className="w-5 text-center text-[10px] font-extrabold text-n-500">
                            {mLetter(m)}
                          </span>
                        ))}
                      </div>
                    </th>
                    <th className="th pt-5 text-right">Bulan ini</th>
                    <th className="th pt-5">Status</th>
                    <th className="th pt-5 pr-5 text-right">Sisa</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id}>
                      <td className="td pl-5">
                        <Link to={`/santri/${r.id}`} className="font-semibold text-n-900">
                          {r.fullName}
                        </Link>
                        <div className="text-xs text-n-600">{r.className}</div>
                      </td>
                      <td className="td text-n-700">Kel. {r.wali}</td>
                      <td className="td">
                        <History r={r} />
                      </td>
                      <td className="td text-right">
                        <div className="num">{rupiah(r.amount)}</div>
                        {r.note && <div className="text-[11px] text-n-600">{r.note}</div>}
                      </td>
                      <td className="td">
                        <Badge status={r.status} />
                      </td>
                      <td className={`td pr-5 text-right num ${r.sisa ? 'text-danger-fg' : 'text-n-400'}`}>{rupiah(r.sisa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="md:hidden p-4 space-y-3">
              {rows.map((r: any) => (
                <div key={r.id} className="card p-4 space-y-3">
                  <div className="flex justify-between items-center gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-sm truncate">{r.fullName}</div>
                      <div className="text-xs text-n-600">Kel. {r.wali}</div>
                    </div>
                    <Badge status={r.status} />
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="flex gap-1 mb-1" aria-hidden>
                        {months.map((m) => (
                          <span key={m} className="w-5 text-center text-[10px] font-extrabold text-n-500">
                            {mLetter(m)}
                          </span>
                        ))}
                      </div>
                      <History r={r} />
                    </div>
                    <b className={`num text-sm ${r.sisa ? 'text-danger-fg' : 'text-n-400'}`}>{rupiah(r.sisa)}</b>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="flex flex-wrap gap-4 px-5 py-4 text-xs text-n-700 border-t border-n-100">
          {Object.entries({ LUNAS: 'Lunas', MENUNGGU: 'Menunggu', BELUM: 'Belum bayar', TUNGGAKAN: 'Tunggakan', TIDAK_DITAGIH: 'Tidak ditagih' }).map(([k, l]) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded" style={{ background: CELL[k] }} />
              {l}
            </span>
          ))}
        </div>
      </Card>

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} title={confirm === 'du' ? 'Tagih daftar ulang' : 'Buat tagihan SPP'}>
        <p className="text-sm text-n-700">
          {confirm === 'du'
            ? `Tagihan daftar ulang${duFee ? ` ${rupiah(duFee)}` : ''} (nominal dari menu Pengaturan) dibuat untuk santri Aktif dan Cuti yang belum ditagih tahun pembelajaran ini. Santri yang sudah ditagih tidak ditagih dua kali.`
            : `Tagihan SPP ${s?.label ?? month} dibuat untuk santri Aktif yang sudah bergabung per tanggal 1, sama seperti penjadwal otomatis. Tagihan yang sudah ada tidak dibuat ulang; paling jauh bulan depan.`}
        </p>
        <div className="flex gap-3 mt-5">
          <button className="btn-soft flex-1" onClick={() => setConfirm(null)}>
            Batal
          </button>
          <button className="btn-primary flex-1" disabled={gen.isPending} onClick={() => gen.mutate(confirm!)}>
            Buat tagihan
          </button>
        </div>
      </Dialog>
    </div>
  );
}
