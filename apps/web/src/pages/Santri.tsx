import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { Download, Plus, Upload } from 'lucide-react';
import { can, download, get, post, tgl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Avatar, Badge, Chips, Dialog, Empty, PageHeader, SearchBox } from '../components/ui';
import { useToast } from '../components/Toast';

const LEVEL: Record<string, string> = {
  JUZ30: 'Juz 30',
  JUZ29: 'Juz 29',
  JUZ28: 'Juz 28',
};
const MASK = 'Disembunyikan';
const hidden = (v?: string | null) => (v === MASK ? <span className="text-n-500">{MASK}</span> : v || '—');

export default function Santri() {
  const { user } = useAuth();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '',
    branchId = sp.get('branchId') ?? '',
    status = sp.get('status') ?? '',
    page = Number(sp.get('page') ?? 1);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    v ? n.set(k, v) : n.delete(k);
    if (k !== 'page') n.delete('page');
    setSp(n);
  };
  const branches = useQuery({
    queryKey: ['branches'],
    queryFn: () => get('/branches'),
  });
  const list = useQuery({
    queryKey: ['students', q, branchId, status, page],
    queryFn: () => get(`/students?q=${encodeURIComponent(q)}&branchId=${branchId}&status=${status}&page=${page}&size=25`),
  });
  const [term, setTerm] = useState(q);
  const [imp, setImp] = useState(false);
  const [impResult, setImpResult] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);
  const exportPdf = () => download(`/export/students.pdf?branchId=${branchId}&status=${status}`, 'santri.pdf');
  const doImport = async (dryRun: boolean) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await post(`/import/students?dryRun=${dryRun}`, fd);
      setImpResult(r);
      if (r.ok && !dryRun) {
        toast(`${r.total} santri diimpor`);
        list.refetch();
      }
    } catch (e: any) {
      setImpResult({ ok: false, errors: [{ row: '-', message: e.message }] });
    }
  };
  const showSubsidi = list.data?.rows.some((r: any) => 'subsidyLabel' in r); // API tidak mengirim kolom ini ke role non-sensitif
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 25));
  return (
    <div>
      <PageHeader
        title="Santri"
        sub="Manajemen pengguna"
        actions={
          <>
            {can(user, 'santri.impor') && (
              <button
                className="btn-secondary"
                onClick={() => {
                  setImp(true);
                  setImpResult(null);
                }}
              >
                <Upload size={16} /> Impor data
              </button>
            )}
            {can(user, 'santri.ekspor') && (
              <button className="btn-secondary" onClick={exportPdf}>
                <Download size={16} /> Ekspor PDF
              </button>
            )}
            {can(user, 'santri.input') && (
              <Link to="/santri/baru" className="btn-primary hidden md:inline-flex">
                <Plus size={16} /> Tambah santri
              </Link>
            )}
          </>
        }
      />
      <div className="space-y-3 mb-4">
        <div className="flex flex-col md:flex-row gap-3">
          <form
            className="md:w-80"
            onSubmit={(e) => {
              e.preventDefault();
              set('q', term);
            }}
          >
            <SearchBox
              value={term}
              onChange={(v) => {
                setTerm(v);
                if (!v) set('q', '');
              }}
              placeholder="Cari nama atau nomor induk"
            />
          </form>
          {!user?.branchIds && (
            <select className="input !h-11 md:!w-auto !rounded-full mt " value={branchId} onChange={(e) => set('branchId', e.target.value)} aria-label="Filter cabang">
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
          value={status}
          onChange={(v) => set('status', v)}
          items={[
            { value: '', label: 'Semua', n: list.data?.counts?.[''] },
            { value: 'AKTIF', label: 'Aktif', n: list.data?.counts?.AKTIF },
            { value: 'CUTI', label: 'Cuti', n: list.data?.counts?.CUTI },
            { value: 'INDENT', label: 'Indent', n: list.data?.counts?.INDENT },
            { value: 'KELUAR', label: 'Keluar', n: list.data?.counts?.KELUAR },
          ]}
        />
      </div>
      <div className="card">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr>
                <th className="th pl-5 pt-4">ID Santri</th>
                <th className="th pt-4 sticky left-0 bg-white z-10">Nama Lengkap</th>
                {[
                  'Jenis Kelamin',
                  'Tempat Lahir',
                  'Tanggal Lahir',
                  'Cabang',
                  'Jenjang',
                  'Tanggal Bergabung',
                  'Status',
                  'Keterangan Pendaftaran',
                  ...(showSubsidi ? ['Kategori Subsidi'] : []),
                  'Nama Ayah',
                  'Nama Ibu',
                  'No WA Wali',
                  'Alamat',
                  'Pekerjaan Ayah',
                  'Pekerjaan Ibu',
                ].map((h, i, a) => (
                  <th key={h} className={`th pt-4 whitespace-nowrap ${i === a.length - 1 ? 'pr-5' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data?.rows.map((s: any) => (
                <tr key={s.id} className="group hover:bg-brand-50 whitespace-nowrap">
                  <td className="td pl-5 num">{s.nis}</td>
                  <td className="td sticky left-0 z-10 bg-white group-hover:bg-brand-50">
                    <Link to={`/santri/${s.id}`} className="flex items-center gap-3">
                      <Avatar name={s.fullName} />
                      <span>
                        <span className="font-semibold text-n-900 block">{s.fullName}</span>
                        {s.nickname && <span className="text-xs text-n-600">{s.nickname}</span>}
                      </span>
                    </Link>
                  </td>
                  <td className="td">{s.gender === 'L' ? 'Laki-laki' : 'Perempuan'}</td>
                  <td className="td">{s.birthPlace}</td>
                  <td className="td">{tgl(s.birthDate)}</td>
                  <td className="td">{s.branchName}</td>
                  <td className="td">{LEVEL[s.level] ?? s.className}</td>
                  <td className="td">{tgl(s.joinDate)}</td>
                  <td className="td">
                    <Badge status={s.status} />
                  </td>
                  <td className="td max-w-[220px] truncate" title={s.registrationNote ?? ''}>
                    {s.registrationNote || '—'}
                  </td>
                  {showSubsidi && <td className="td">{s.subsidyLabel || '—'}</td>}
                  <td className="td">{s.fatherName}</td>
                  <td className="td">{s.motherName}</td>
                  <td className="td num">{hidden(s.waPhone)}</td>
                  <td className="td max-w-[260px] truncate" title={s.address === MASK ? '' : (s.address ?? '')}>
                    {hidden(s.address)}
                  </td>
                  <td className="td">{hidden(s.fatherJob)}</td>
                  <td className="td pr-5">{hidden(s.motherJob)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="md:hidden p-4 space-y-3">
          {list.data?.rows.map((s: any) => (
            <Link key={s.id} to={`/santri/${s.id}`} className="card flex items-center gap-3 px-4 min-h-[72px]">
              <Avatar name={s.fullName} />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm truncate">{s.fullName}</div>
                <div className="text-xs text-n-600 truncate">
                  {s.nis} · {s.branchName} {LEVEL[s.level] ?? s.className}
                </div>
                <div className="text-xs text-n-600 truncate">
                  Wali: {s.fatherName} & {s.motherName}
                </div>
              </div>
              <Badge status={s.status} />
            </Link>
          ))}
        </div>
        {list.data && !list.data.rows.length && (
          <Empty
            text="Belum ada santri yang cocok."
            action={
              can(user, 'santri.input') && (
                <Link to="/santri/baru" className="btn-primary">
                  Tambah santri
                </Link>
              )
            }
          />
        )}
      </div>
      {can(user, 'santri.input') && (
        <Link
          to="/santri/baru"
          aria-label="Tambah santri"
          className="md:hidden fixed right-5 bottom-[104px] z-30 w-14 h-14 rounded-[20px] bg-brand-600 text-white shadow-brand flex items-center justify-center"
        >
          <Plus size={26} />
        </Link>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 mt-4 text-sm">
          <button className="btn-secondary !h-9" disabled={page <= 1} onClick={() => set('page', String(page - 1))}>
            ‹
          </button>
          <span className="tnum">
            {page} / {pages}
          </span>
          <button className="btn-secondary !h-9" disabled={page >= pages} onClick={() => set('page', String(page + 1))}>
            ›
          </button>
        </div>
      )}

      <Dialog open={imp} onClose={() => setImp(false)} title="Impor data santri">
        <div className="space-y-4 text-sm">
          <p>
            Unduh template, isi di Excel/Google Sheets, lalu unggah file <b>.xlsx</b> atau <b>CSV</b> (sheet pertama yang dibaca). Seluruh file divalidasi dulu; jika ada baris bermasalah, tidak ada
            data yang disimpan.
          </p>
          <p className="text-n-600">
            Status: <b>INDENT</b>, <b>AKTIF</b>, <b>CUTI</b>, atau <b>KELUAR</b>.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => download('/import/students/template?format=xlsx', 'template-santri.xlsx')}>
              Unduh template (Excel)
            </button>
            <button className="btn-text" onClick={() => download('/import/students/template', 'template-santri.csv')}>
              Template CSV
            </button>
          </div>
          <input
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setImpResult(null);
            }}
            className="block"
          />
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={!file} onClick={() => doImport(true)}>
              Periksa dulu
            </button>
            <button className="btn-primary" disabled={!file || !impResult?.ok} onClick={() => doImport(false)}>
              Impor
            </button>
          </div>
          {impResult &&
            (impResult.ok ? (
              <Alert kind="success">{impResult.dryRun ? `${impResult.total} baris valid. Klik Impor untuk menyimpan.` : `${impResult.total} santri tersimpan.`}</Alert>
            ) : (
              <div>
                <Alert>{impResult.errors.length} masalah ditemukan. Perbaiki lalu unggah ulang.</Alert>
                <ul className="mt-2 max-h-48 overflow-auto text-xs space-y-1">
                  {impResult.errors.map((e: any, i: number) => (
                    <li key={i}>
                      Baris {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      </Dialog>
    </div>
  );
}
