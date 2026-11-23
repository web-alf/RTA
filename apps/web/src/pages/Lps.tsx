import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Lock } from 'lucide-react';
import { can, download, get, monthWIB, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { Alert, Avatar, Badge, Bar, Card, Chips, COLOR, Dialog, Drawer, Empty, Field, PageHeader, Ring, SearchBox, StackBar } from '../components/ui';

const ST_COLOR: Record<string, string> = { TERBIT: COLOR.lunas, DISETUJUI: COLOR.belum, DIPERIKSA: COLOR.menunggu, DRAFT: COLOR.rose, BELUM: COLOR.netral };
const NILAI_CLS: Record<string, string> = { 'Sangat baik': 'bg-mint-bg text-mint-fg', Baik: 'bg-lilac-bg text-lilac-fg', 'Perlu latihan': 'bg-butter-bg text-butter-fg' };
const NEXT: Record<string, [string, string, string]> = {
  DRAFT: ['submit', 'Kirim untuk diperiksa', 'lps.edit'],
  DIPERIKSA: ['approve', 'Setujui', 'lps.setujui'],
  DISETUJUI: ['publish', 'Terbitkan', 'lps.setujui'],
};
const fmt = (n: number) => String(n).replace('.', ',');

export default function Lps() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [period, setPeriod] = useState(monthWIB());
  const [q, setQ] = useState('');
  const [st, setSt] = useState('');
  const [branchId, setBranchId] = useState('');
  const [open, setOpen] = useState<any>(null);
  const data = useQuery({ queryKey: ['lps', period, q, branchId], queryFn: () => get(`/lps?period=${period}${q ? `&q=${encodeURIComponent(q)}` : ''}${branchId ? `&branchId=${branchId}` : ''}`) });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => get('/branches'), enabled: !user?.branchIds });
  const gen = useMutation({
    mutationFn: () => post('/lps/generate', { period }),
    onSuccess: (d: any) => {
      toast(`${d.created} draft LPS dibuat`);
      qc.invalidateQueries({ queryKey: ['lps'] });
    },
  });
  const d = data.data;
  const s = d?.summary ?? {};
  const readOnly = !can(user, 'lps.edit');
  const rows = (d?.rows ?? []).filter((r: any) => !st || r.status === st);
  const pct = s.total ? Math.round((s.TERBIT / s.total) * 100) : 0;
  const COLORS = ['#ad1d8e', '#8b74d9', '#5fb38a', '#f2c766'];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Laporan perkembangan santri"
        sub={`Periode ${d?.label ?? ''}`}
        actions={
          <>
            {user?.branchIds && (
              <span className="pill h-10 px-4 bg-white text-brand-800 shadow-soft">
                <Lock size={14} />
                Cabang Anda
              </span>
            )}
            {readOnly && <span className="pill h-10 px-4 bg-lilac-bg text-lilac-fg">Hanya baca</span>}
            <input type="month" className="input !h-10 !w-auto !rounded-full" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Periode" />
            {can(user, 'lps.input') && (
              <button className="btn-primary" disabled={gen.isPending} onClick={() => gen.mutate()}>
                + Buat draft LPS
              </button>
            )}
          </>
        }
      />
      {readOnly && <Alert kind="info">Anda melihat LPS santri di cabang yang ditugaskan. Pengisian dan penerbitan dilakukan oleh PJ RTA.</Alert>}

      {d && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          <Card title="Kelengkapan LPS">
            <div className="flex items-center gap-4">
              <Ring
                size={128}
                label={`${s.TERBIT} dari ${s.total} LPS terbit`}
                center={`${pct}%`}
                sub={`${s.TERBIT} / ${s.total} terbit`}
                segments={['TERBIT', 'DISETUJUI', 'DIPERIKSA', 'DRAFT', 'BELUM'].map((k) => ({ value: s[k], color: ST_COLOR[k] }))}
              />
              <div className="grid gap-1.5 text-xs flex-1">
                {[
                  ['TERBIT', 'Terbit'],
                  ['DISETUJUI', 'Disetujui'],
                  ['DIPERIKSA', 'Diperiksa'],
                  ['DRAFT', 'Draft'],
                  ['BELUM', 'Belum dibuat'],
                ].map(([k, l]) => (
                  <div key={k} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: ST_COLOR[k] }} />
                    {l}
                    <b className="ml-auto">{s[k]}</b>
                  </div>
                ))}
              </div>
            </div>
          </Card>
          <Card title="Penilaian per aspek">
            <div className="space-y-3.5">
              {d.aspects.map((a: any) => (
                <div key={a.aspek}>
                  <div className="flex justify-between text-[13px] mb-1.5">
                    <b>{a.aspek}</b>
                    <span className="text-n-600">{a.n ? `${a.sangatBaik}% sangat baik` : 'belum ada nilai'}</span>
                  </div>
                  <StackBar
                    h={12}
                    label={`${a.aspek}: ${a.sangatBaik}% sangat baik, ${a.baik}% baik, ${a.perluLatihan}% perlu latihan`}
                    parts={
                      a.n
                        ? [
                            { value: a.sangatBaik, color: COLOR.lunas },
                            { value: a.baik, color: COLOR.menunggu },
                            { value: a.perluLatihan, color: COLOR.belum },
                          ]
                        : [{ value: 1, color: COLOR.netral }]
                    }
                  />
                </div>
              ))}
              <div className="flex flex-wrap gap-3 text-xs text-n-700 pt-1">
                {[
                  ['Sangat baik', COLOR.lunas],
                  ['Baik', COLOR.menunggu],
                  ['Perlu latihan', COLOR.belum],
                ].map(([l, c]) => (
                  <span key={l} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded" style={{ background: c }} />
                    {l}
                  </span>
                ))}
              </div>
            </div>
          </Card>
          <Card title={d.branches.length > 1 ? 'Terbit per cabang' : 'Terbit per kelas'} className="md:col-span-2 xl:col-span-1">
            {(d.branches.length > 1
              ? d.branches
              : Object.values(
                  d.rows.reduce((a: any, r: any) => {
                    a[r.className] ??= { name: r.className, total: 0, terbit: 0 };
                    a[r.className].total++;
                    if (r.status === 'TERBIT') a[r.className].terbit++;
                    return a;
                  }, {}),
                )
            ).map((b: any, i: number) => (
              <div key={b.name} className="py-2">
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="font-semibold">{b.name}</span>
                  <b className="num">
                    {b.terbit}/{b.total}
                  </b>
                </div>
                <Bar value={b.terbit} max={b.total} color={COLORS[i % 4]} h={10} label={`${b.name}: ${b.terbit} dari ${b.total} terbit`} />
              </div>
            ))}
          </Card>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-3 md:items-center">
        <SearchBox value={q} onChange={setQ} placeholder="Cari santri, nomor induk, atau kelas" className="md:w-96" />
        {!user?.branchIds && (
          <select className="input !h-10 !w-auto !rounded-full" value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Filter cabang">
            <option value="">Semua cabang</option>
            {branches.data?.map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <Chips
        label="Filter status"
        value={st}
        onChange={setSt}
        items={[
          { value: '', label: 'Semua', n: s.total },
          { value: 'BELUM', label: 'Belum dibuat', n: s.BELUM },
          { value: 'DRAFT', label: 'Draft', n: s.DRAFT },
          { value: 'DIPERIKSA', label: 'Diperiksa', n: s.DIPERIKSA },
          { value: 'DISETUJUI', label: 'Disetujui', n: s.DISETUJUI },
          { value: 'TERBIT', label: 'Terbit', n: s.TERBIT },
        ]}
      />

      <Card pad={false}>
        {q && (
          <div className="px-5 pt-4 text-[13px] text-n-600">
            Hasil pencarian “<b className="text-n-900">{q}</b>” · {rows.length} santri{' '}
            <button className="font-semibold text-brand-700 ml-2" onClick={() => setQ('')}>
              Hapus pencarian
            </button>
          </div>
        )}
        {rows.length === 0 ? (
          <Empty icon={FileText} text={data.isLoading ? 'Memuat…' : 'Tidak ada LPS untuk filter ini.'} />
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr>
                    <th className="th pl-5">Santri</th>
                    <th className="th">Kelas</th>
                    <th className="th">Hafalan</th>
                    <th className="th">Diperbarui</th>
                    <th className="th">Status</th>
                    <th className="th pr-5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.studentId}>
                      <td className="td pl-5">
                        <div className="flex items-center gap-3">
                          <Avatar name={r.fullName} size={36} />
                          <div>
                            <div className="font-semibold">{r.fullName}</div>
                            <div className="text-xs text-n-600">{r.nis}</div>
                          </div>
                        </div>
                      </td>
                      <td className="td">{r.className}</td>
                      <td className="td">
                        {r.hafalanPercent != null ? (
                          <div className="flex items-center gap-2">
                            <div className="w-16">
                              <Bar value={r.hafalanPercent} h={6} />
                            </div>
                            <b className="num text-[13px]">{fmt(r.hafalanPercent)}%</b>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="td text-n-600 text-[13px]">{r.updatedBy ?? '—'}</td>
                      <td className="td">
                        <Badge status={r.status} label={r.status === 'BELUM' ? 'Belum dibuat' : undefined} />
                      </td>
                      <td className="td pr-5 text-right">
                        {r.id && (r.status === 'TERBIT' || !readOnly) ? (
                          <button className="btn-soft !h-9" onClick={() => setOpen(r)}>
                            {readOnly || r.status === 'TERBIT' ? 'Lihat' : r.status === 'DRAFT' ? 'Isi' : 'Periksa'}
                          </button>
                        ) : (
                          <span className="text-xs text-n-500">{r.id ? 'Belum terbit' : ''}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="md:hidden p-4 space-y-3">
              {rows.map((r: any) => (
                <button
                  key={r.studentId}
                  disabled={!r.id || (readOnly && r.status !== 'TERBIT')}
                  onClick={() => setOpen(r)}
                  className="card w-full flex items-center gap-3 px-4 min-h-[72px] text-left"
                >
                  <Avatar name={r.fullName} />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">{r.fullName}</div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="w-16">
                        <Bar value={r.hafalanPercent ?? 0} h={6} />
                      </div>
                      <span className="text-xs text-n-600">{r.hafalanPercent != null ? `${fmt(r.hafalanPercent)}%` : '—'}</span>
                    </div>
                  </div>
                  <Badge status={r.status} label={r.status === 'BELUM' ? 'Belum' : undefined} />
                </button>
              ))}
            </div>
          </>
        )}
      </Card>
      {open && <LpsDrawer row={open} aspekList={d.aspekList} nilaiList={d.nilaiList} period={period} label={d.label} onClose={() => setOpen(null)} />}
    </div>
  );
}

function LpsDrawer({ row, aspekList, nilaiList, period, label, onClose }: { row: any; aspekList: string[]; nilaiList: string[]; period: string; label: string; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [scores, setScores] = useState<Record<string, string>>(row.scores ?? {});
  const [note, setNote] = useState((row.note ?? '').replace(/\n\[Revisi\][\s\S]*/, ''));
  const [revise, setRevise] = useState(false);
  const [rnote, setRnote] = useState('');
  const editable = row.status === 'DRAFT' && can(user, 'lps.edit');
  const done = (msg: string) => {
    toast(msg);
    qc.invalidateQueries({ queryKey: ['lps'] });
    onClose();
  };
  const run = async (fn: () => Promise<any>, msg: string) => {
    try {
      await fn();
      done(msg);
    } catch (e: any) {
      toast(e.message, 'danger');
    }
  };
  const next = NEXT[row.status];
  const revisions = (row.note ?? '').match(/\[Revisi\][^\n]*/g) ?? [];
  return (
    <Drawer
      open
      onClose={onClose}
      title={row.fullName}
      sub={`LPS ${label} · ${row.className}`}
      badge={<Badge status={row.status} />}
      footer={
        <div className="flex flex-wrap gap-3">
          {row.status === 'TERBIT' && (
            <button className="btn-primary flex-1" onClick={() => download(`/lps/${row.id}/pdf`, `LPS-${row.nis}-${period}.pdf`)}>
              Unduh PDF
            </button>
          )}
          {editable && (
            <button className="btn-secondary flex-1" onClick={() => run(() => patch(`/lps/${row.id}`, { scores, note }), 'Nilai tersimpan')}>
              Simpan draft
            </button>
          )}
          {next && can(user, next[2]) && (
            <button
              className="btn-primary flex-1"
              onClick={() =>
                run(async () => {
                  if (editable) await patch(`/lps/${row.id}`, { scores, note });
                  await post(`/lps/${row.id}/${next[0]}`);
                }, `${next[1]}: berhasil`)
              }
            >
              {next[1]}
            </button>
          )}
          {['DIPERIKSA', 'DISETUJUI'].includes(row.status) && can(user, 'lps.setujui') && (
            <button className="btn-text !text-danger-fg" onClick={() => setRevise(true)}>
              Kembalikan
            </button>
          )}
        </div>
      }
    >
      <div className="card p-4 space-y-4">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-[14px] bg-brand-600 text-white flex items-center justify-center font-display font-black">R</span>
          <div>
            <div className="font-display font-extrabold">{row.fullName}</div>
            <div className="text-xs text-n-600">
              {row.branchName} · {row.className}
            </div>
          </div>
        </div>
        <div className="p-3.5 rounded-2xl bg-brand-50">
          <div className="text-xs font-bold text-brand-800">Hafalan (otomatis)</div>
          <div className="num text-2xl mt-1">{row.hafalanPercent != null ? `${fmt(row.hafalanPercent)}%` : '—'}</div>
          <div className="text-xs text-n-700">{row.hafalanPosition ?? 'Belum ada catatan hafalan'}</div>
        </div>
        {aspekList.map((a) => (
          <div key={a} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold">{a}</span>
            {editable ? (
              <div role="radiogroup" aria-label={a} className="flex gap-1.5 flex-wrap">
                {nilaiList.map((v) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={scores[a] === v}
                    onClick={() => setScores({ ...scores, [a]: v })}
                    className={`pill h-8 ${scores[a] === v ? NILAI_CLS[v] + ' ring-2 ring-current' : 'bg-n-50 text-n-700'}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            ) : (
              <span className={`pill ${NILAI_CLS[scores[a]] ?? 'bg-n-100 text-n-600'}`}>{scores[a] ?? '—'}</span>
            )}
          </div>
        ))}
        {editable ? (
          <Field label="Catatan ustadzah">
            <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        ) : (
          note && <div className="text-sm text-n-800 px-4 py-3 rounded-2xl bg-n-50">“{note}”</div>
        )}
      </div>
      {revisions.length > 0 && (
        <Alert kind="warning">
          {revisions.map((r: string) => (
            <div key={r}>{r.replace('[Revisi] ', 'Revisi: ')}</div>
          ))}
        </Alert>
      )}
      <Dialog open={revise} onClose={() => setRevise(false)} title="Kembalikan ke draft">
        <Field label="Catatan revisi (wajib)">
          <textarea className="input" rows={3} value={rnote} onChange={(e) => setRnote(e.target.value)} />
        </Field>
        <div className="flex gap-3 mt-5">
          <button className="btn-soft flex-1" onClick={() => setRevise(false)}>
            Batal
          </button>
          <button className="btn-primary flex-1" disabled={rnote.trim().length < 3} onClick={() => run(() => post(`/lps/${row.id}/revise`, { note: rnote }), 'Dikembalikan ke draft')}>
            Kembalikan
          </button>
        </div>
      </Dialog>
    </Drawer>
  );
}
