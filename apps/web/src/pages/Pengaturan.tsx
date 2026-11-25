import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgePercent, Building2, CalendarCheck, CalendarRange, Landmark, MessageCircle, Plus } from 'lucide-react';
import { can, get, patch, post, rupiah, tgl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { Alert, Card, Dialog, Field, IconTile, PageHeader, Segmented, Toggle } from '../components/ui';

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const KEYS = ['reregistrationFee', 'academicYearStartMonth', 'registrationMinDp', 'registrationMaxInstallments', 'linkDays', 'waTemplate', 'attendanceDays', 'attendanceAlpaStreak', 'attendanceMinPercent', 'attendanceWaTemplate'] as const;
const SAMPLE = { tagihan: 'SPP November', nama: 'Aisyah & Hafsah', total: 'Rp300.000', link: 'https://…/bayar/contoh' };
const render = (t: string) => t.replace(/\{(\w+)\}/g, (m, k) => (SAMPLE as any)[k] ?? m);
const SAMPLE_ABS = { nama: 'Aisyah', tanggal: '20, 23 & 24 Nov', link: 'https://…/perkembangan' };
const renderAbs = (t: string) => t.replace(/\{(\w+)\}/g, (m, k) => (SAMPLE_ABS as any)[k] ?? m);
const HARI = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Ahd'];

export default function Pengaturan() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const edit = can(user, 'pengaturan.edit');
  const canBank = can(user, 'pengaturan.input'); // rekening cabang (server membatasi ke cabang pengguna)
  const [bank, setBank] = useState<any>(null);
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get('/settings') });
  const [form, setForm] = useState<any>(null);
  const [err, setErr] = useState('');
  const [branch, setBranch] = useState<any>(null);
  const [subDlg, setSubDlg] = useState<any>(null);
  const subs = useQuery({ queryKey: ['subsidies'], queryFn: () => get('/subsidies'), enabled: can(user, 'spp.input') });
  useEffect(() => {
    if (q.data) setForm(q.data.values);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => patch('/settings', Object.fromEntries(KEYS.map((k) => [k, form[k]]))),
    onSuccess: (d: any) => {
      toast(d.changed ? 'Pengaturan tersimpan' : 'Tidak ada perubahan');
      setErr('');
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e: any) => setErr(e.details?.join(', ') ?? e.message),
  });
  if (!q.data || !form) return <p className="text-sm text-n-600">Memuat…</p>;
  const d = q.data;
  const dirty = KEYS.some((k) => JSON.stringify(form[k]) !== JSON.stringify(d.values[k]));
  const set = (k: string, v: any) => setForm({ ...form, [k]: v });
  const num = (k: string) => ({
    type: 'number',
    inputMode: 'numeric' as const,
    min: 0,
    className: 'input',
    value: form[k],
    disabled: !edit,
    onChange: (e: any) => set(k, e.target.value === '' ? '' : Number(e.target.value)),
  });
  const txt = (k: string) => ({ className: 'input', value: form[k], disabled: !edit, onChange: (e: any) => set(k, e.target.value) });
  const lines = String(form.waTemplate).split('\n').length;
  const bankCard = (
    <Card
      title={
        <span className="flex items-center gap-3">
          <IconTile icon={Landmark} tone={2} />
          Rekening per cabang
        </span>
      }
      pad={false}
    >
      <p className="px-4 md:px-5 -mt-1 mb-3 text-sm text-n-600">
        Tampil di halaman tagihan wali dan portal wali sesuai cabang santri. Pastikan sama persis dengan buku rekening.
      </p>
      <div className="px-4 md:px-5 pb-4 md:pb-5 space-y-3">
        {d.banks.map((b: any) => (
          <div key={b.branchId} className="flex items-center gap-3 p-4 rounded-2xl bg-n-50">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-n-600">{b.branchName}</div>
              <div className="font-semibold truncate">
                {b.name} · <span className="num">{b.account}</span>
              </div>
              <div className="text-xs text-n-600 truncate">
                a.n. {b.holder}
                {b.isDefault && ' · masih rekening bawaan yayasan'}
              </div>
            </div>
            {canBank && (
              <button className="btn-secondary !h-11 shrink-0" onClick={() => setBank(b)}>
                Ubah
              </button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pengaturan"
        sub={d.updatedAt ? `Terakhir diubah ${tgl(d.updatedAt)} oleh ${d.updatedBy ?? '-'}` : 'Masih memakai nilai bawaan'}
        actions={
          !edit && (
            <span className="pill h-10 px-4 bg-lilac-bg text-lilac-fg">
              {canBank ? `🔒 ${d.banks.map((b: any) => b.branchName).join(', ')} · hanya rekening yang bisa diubah` : 'Hanya baca'}
            </span>
          )
        }
      />

      {!edit && bankCard}

      <Card
        title={
          <span className="flex items-center gap-3">
            <IconTile icon={Building2} tone={0} />
            Tarif per cabang
          </span>
        }
        pad={false}
      >
        <p className="px-4 md:px-5 -mt-1 mb-3 text-sm text-n-600">Tarif SPP standar dipakai untuk santri baru dan mutasi ke cabang itu. Tagihan yang sudah terbit tidak berubah.</p>
        <div className="hidden md:block scroll-x">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th pl-5">Cabang</th>
                <th className="th text-right">SPP standar</th>
                <th className="th text-right">Pendaftaran</th>
                <th className="th text-right">Santri bertarif standar</th>
                {edit && <th className="th" />}
              </tr>
            </thead>
            <tbody>
              {d.branches.map((b: any) => (
                <tr key={b.id}>
                  <td className="td pl-5 font-semibold">{b.name}</td>
                  <td className="td text-right num">{rupiah(b.sppStandard)}</td>
                  <td className="td text-right num">{rupiah(b.registrationFee)}</td>
                  <td className="td text-right">
                    {b.santriTarifStandar} dari {b.santri}
                  </td>
                  {edit && (
                    <td className="td text-right pr-5">
                      <button className="btn-text !h-9" onClick={() => setBranch(b)}>
                        Ubah
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="md:hidden px-4 pb-4 space-y-3">
          {d.branches.map((b: any) => (
            <div key={b.id} className="flex items-center gap-3 p-4 rounded-2xl bg-n-50">
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{b.name}</div>
                <div className="text-xs text-n-600">
                  SPP {rupiah(b.sppStandard)} · Pendaftaran {rupiah(b.registrationFee)}
                </div>
                <div className="text-xs text-n-600">
                  {b.santriTarifStandar} dari {b.santri} santri bertarif standar
                </div>
              </div>
              {edit && (
                <button className="btn-secondary !h-11" onClick={() => setBranch(b)}>
                  Ubah
                </button>
              )}
            </div>
          ))}
        </div>
      </Card>

      {subs.data && <SubsidyCard subs={subs.data} branches={d.branches} edit={edit} onEdit={setSubDlg} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start [&>*]:min-w-0">
        <Card
          title={
            <span className="flex items-center gap-3">
              <IconTile icon={CalendarRange} tone={1} />
              Daftar ulang, tahun ajaran & cicilan
            </span>
          }
        >
          <div className="space-y-4">
            <Field label="Biaya daftar ulang (Rp)" hint={`${rupiah(Number(form.reregistrationFee) || 0)} per santri per tahun ajaran; juga dipakai sebagai biaya pindah cabang.`}>
              <input {...num('reregistrationFee')} />
            </Field>
            <Field label="Tahun ajaran dimulai bulan" hint="Ubah hanya sebelum tahun ajaran baru dimulai. Santri yang sudah ditagih tahun ini tidak ditagih lagi.">
              <select {...txt('academicYearStartMonth')} onChange={(e) => set('academicYearStartMonth', Number(e.target.value))}>
                {BULAN.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <div className="pt-1 border-t border-n-100" />
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Cicilan pendaftaran: DP minimal (Rp)" hint={`${rupiah(Number(form.registrationMinDp) || 0)}; biaya pendaftaran di bawah nilai ini harus lunas.`}>
                <input {...num('registrationMinDp')} />
              </Field>
              <Field label="Maksimal kali bayar (termasuk DP)" hint="1 = cicilan dimatikan. Berlaku untuk skema baru.">
                <select {...txt('registrationMaxInstallments')} onChange={(e) => set('registrationMaxInstallments', Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n === 1 ? '1 kali (tidak bisa dicicil)' : `${n} kali`}</option>)}
                </select>
              </Field>
            </div>
          </div>
        </Card>

        {edit && bankCard}
      </div>

      <Card
        title={
          <span className="flex items-center gap-3">
            <IconTile icon={MessageCircle} tone={3} />
            Link & pesan WA tagihan
          </span>
        }
      >
        <div className="grid lg:grid-cols-2 gap-5">
          <div className="space-y-4">
            <Field label="Link wali berlaku (hari)" hint="1–90 hari. Membuat link baru selalu mencabut link lama keluarga itu.">
              <input {...num('linkDays')} min={1} max={90} />
            </Field>
            <Field label="Template pesan" hint={`${lines}/5 baris · wajib memuat {link} · tanpa nada menekan, tanpa menyebut kategori subsidi.`}>
              <textarea {...txt('waTemplate')} rows={5} className="input !h-auto py-3 font-mono text-[13px]" />
            </Field>
            {edit && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-n-600">
                Sisipkan:
                {d.placeholders.map((p: string) => (
                  <button key={p} type="button" className="pill h-8 bg-n-50 text-brand-800 font-mono" onClick={() => set('waTemplate', `${form.waTemplate}{${p}}`)}>{`{${p}}`}</button>
                ))}
                {form.waTemplate !== d.defaults.waTemplate && (
                  <button type="button" className="btn-text !h-8" onClick={() => set('waTemplate', d.defaults.waTemplate)}>
                    Kembalikan bawaan
                  </button>
                )}
              </div>
            )}
          </div>
          <div>
            <div className="label">Pratinjau (contoh data)</div>
            <div className="rounded-2xl bg-mint-bg p-4 text-sm whitespace-pre-wrap break-words">{render(form.waTemplate)}</div>
          </div>
        </div>
      </Card>

      <Card
        title={
          <span className="flex items-center gap-3">
            <IconTile icon={CalendarCheck} tone={0} />
            Absensi
          </span>
        }
      >
        <div className="grid lg:grid-cols-2 gap-5">
          <div className="space-y-4">
            <div>
              <span className="label">Hari belajar</span>
              <div role="group" aria-label="Hari belajar" className="flex flex-wrap gap-2">
                {HARI.map((h, i) => {
                  const on = (form.attendanceDays as number[]).includes(i + 1);
                  return (
                    <button key={h} type="button" aria-pressed={on} disabled={!edit} className={`${on ? 'chip-on' : 'chip-off'} !h-11 min-w-[52px] justify-center disabled:opacity-70`}
                      onClick={() => set('attendanceDays', on ? form.attendanceDays.filter((x: number) => x !== i + 1) : [...form.attendanceDays, i + 1].sort((a: number, b: number) => a - b))}>
                      {h}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-n-600">Hari di luar pilihan ini dan libur di menu Agenda otomatis dikunci di absensi.</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Alpa berturut-turut" hint="Jumlah pertemuan alpa berturut-turut yang memicu tanda perlu perhatian.">
                <select {...txt('attendanceAlpaStreak')} onChange={(e) => set('attendanceAlpaStreak', Number(e.target.value))}>
                  {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n} kali</option>)}
                </select>
              </Field>
              <Field label="Batas kehadiran (%)" hint="Kehadiran bulanan di bawah nilai ini = perlu perhatian.">
                <input {...num('attendanceMinPercent')} min={50} max={100} />
              </Field>
            </div>
            <Field label="Template pesan WA ke wali" hint={`${String(form.attendanceWaTemplate).split('\n').length}/5 baris · wajib memuat {link} · hangat, tanpa nada menekan.`}>
              <textarea {...txt('attendanceWaTemplate')} rows={4} className="input !h-auto py-3 font-mono text-[13px]" />
            </Field>
            {edit && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-n-600">
                Sisipkan:
                {(d.attendancePlaceholders ?? []).map((p: string) => (
                  <button key={p} type="button" className="pill h-8 bg-n-50 text-brand-800 font-mono" onClick={() => set('attendanceWaTemplate', `${form.attendanceWaTemplate}{${p}}`)}>{`{${p}}`}</button>
                ))}
                {form.attendanceWaTemplate !== d.defaults.attendanceWaTemplate && (
                  <button type="button" className="btn-text !h-8" onClick={() => set('attendanceWaTemplate', d.defaults.attendanceWaTemplate)}>
                    Kembalikan bawaan
                  </button>
                )}
              </div>
            )}
          </div>
          <div>
            <div className="label">Pratinjau (contoh data)</div>
            <div className="rounded-2xl bg-mint-bg p-4 text-sm whitespace-pre-wrap break-words">{renderAbs(form.attendanceWaTemplate)}</div>
          </div>
        </div>
      </Card>

      {edit && (
        <div className={`sticky bottom-[104px] md:bottom-4 z-20 ${dirty || err ? '' : 'hidden'}`}>
          <div className="card p-3 md:p-4 flex flex-wrap items-center gap-3 shadow-soft">
            <div className="flex-1 min-w-[180px]">{err ? <Alert>{err}</Alert> : <span className="text-sm text-n-700">Ada perubahan yang belum disimpan.</span>}</div>
            <button
              className="btn-soft"
              onClick={() => {
                setForm(d.values);
                setErr('');
              }}
            >
              Batal
            </button>
            <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
              Simpan pengaturan
            </button>
          </div>
        </div>
      )}

      <BranchDialog b={branch} onClose={() => setBranch(null)} />
      <BankDialog b={bank} onClose={() => setBank(null)} />
      <SubsidyDialog x={subDlg} branches={d.branches} onClose={() => setSubDlg(null)} />
    </div>
  );
}

function BranchDialog({ b, onClose }: { b: any; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ sppStandard: 0, registrationFee: 0, applyToStudents: false });
  const [err, setErr] = useState('');
  useEffect(() => {
    if (b) {
      setF({ sppStandard: b.sppStandard, registrationFee: b.registrationFee, applyToStudents: false });
      setErr('');
    }
  }, [b]);
  const save = useMutation({
    mutationFn: () => patch(`/settings/branches/${b.id}`, f),
    onSuccess: (d: any) => {
      toast(d.santriDiubah ? `Tarif tersimpan · ${d.santriDiubah} santri ikut diperbarui` : 'Tarif tersimpan');
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['branches'] });
      onClose();
    },
    onError: (e: any) => setErr(e.details?.join(', ') ?? e.message),
  });
  const changed = b && f.sppStandard !== b.sppStandard;
  return (
    <Dialog open={!!b} onClose={onClose} title={`Tarif cabang ${b?.name ?? ''}`}>
      <div className="space-y-4">
        {err && <Alert>{err}</Alert>}
        <Field label="SPP standar per bulan (Rp)" hint={rupiah(f.sppStandard || 0)}>
          <input type="number" inputMode="numeric" min={0} className="input" value={f.sppStandard} onChange={(e) => setF({ ...f, sppStandard: Number(e.target.value) })} />
        </Field>
        <Field label="Biaya pendaftaran (Rp)" hint={`${rupiah(f.registrationFee || 0)} · ditagih otomatis saat santri baru didaftarkan`}>
          <input type="number" inputMode="numeric" min={0} className="input" value={f.registrationFee} onChange={(e) => setF({ ...f, registrationFee: Number(e.target.value) })} />
        </Field>
        {changed && b.santriTarifStandar + b.santriDiskon > 0 && (
          <label className="flex items-start gap-3 p-3.5 rounded-2xl bg-white shadow-soft text-sm">
            <input type="checkbox" className="w-5 h-5 mt-0.5 accent-brand-600" checked={f.applyToStudents} onChange={(e) => setF({ ...f, applyToStudents: e.target.checked })} />
            <span>
              Terapkan juga ke <b>{b.santriTarifStandar} santri</b> yang tarifnya masih {rupiah(b.sppStandard)}
              {b.santriDiskon > 0 && (
                <>
                  {' '}
                  dan <b>{b.santriDiskon} santri</b> bersubsidi diskon (dihitung ulang dari tarif baru)
                </>
              )}
              . Berlaku mulai tagihan SPP berikutnya; tarif khusus dan subsidi tarif pengganti tidak ikut berubah.
            </span>
          </label>
        )}
        <Alert kind="info">Tagihan yang sudah terbit tetap memakai nominal lama.</Alert>
        <div className="flex gap-3">
          <button className="btn-soft flex-1" onClick={onClose}>
            Batal
          </button>
          <button className="btn-primary flex-1" disabled={save.isPending} onClick={() => save.mutate()}>
            Simpan tarif
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function BankDialog({ b, onClose }: { b: any; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ bankName: '', bankAccount: '', bankHolder: '' });
  const [err, setErr] = useState('');
  useEffect(() => {
    if (b) {
      setF(b.isDefault ? { bankName: '', bankAccount: '', bankHolder: '' } : { bankName: b.name, bankAccount: b.account, bankHolder: b.holder });
      setErr('');
    }
  }, [b]);
  const save = useMutation({
    mutationFn: () => patch(`/settings/branches/${b.branchId}/bank`, f),
    onSuccess: (d: any) => {
      toast(d.changed ? `Rekening ${b.branchName} tersimpan` : 'Tidak ada perubahan');
      qc.invalidateQueries({ queryKey: ['settings'] });
      onClose();
    },
    onError: (e: any) => setErr(e.details?.join(', ') ?? e.message),
  });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={!!b} onClose={onClose} title={`Rekening cabang ${b?.branchName ?? ''}`}>
      <div className="space-y-4">
        {err && <Alert>{err}</Alert>}
        {b?.isDefault && <Alert kind="info">Cabang ini masih memakai rekening bawaan yayasan ({b.name} · {b.account}). Isi rekening khusus cabang ini.</Alert>}
        <Field label="Nama bank">
          <input className="input" value={f.bankName} onChange={set('bankName')} placeholder="mis. Bank Syariah Indonesia" maxLength={60} />
        </Field>
        <Field label="Nomor rekening" hint="Angka saja; boleh spasi agar mudah dibaca wali.">
          <input className="input num" inputMode="numeric" value={f.bankAccount} onChange={set('bankAccount')} maxLength={40} />
        </Field>
        <Field label="Atas nama">
          <input className="input" value={f.bankHolder} onChange={set('bankHolder')} maxLength={80} />
        </Field>
        <Alert kind="info">Berlaku langsung di halaman tagihan wali untuk santri cabang ini, termasuk link yang sudah terkirim. Perubahan tercatat di audit log.</Alert>
        <div className="flex gap-3">
          <button className="btn-soft flex-1" onClick={onClose}>
            Batal
          </button>
          <button className="btn-primary flex-1" disabled={save.isPending || !f.bankName.trim() || !f.bankAccount.trim() || !f.bankHolder.trim()} onClick={() => save.mutate()}>
            Simpan rekening
          </button>
        </div>
      </div>
    </Dialog>
  );
}

const KIND = { TARIF: 'Tarif pengganti', DISKON: 'Diskon' } as const;
const cell = (x: any, b: any) => x.rates.find((r: any) => r.branchId === b.id && r.available);

/** Master subsidi SPP (prd.md 8.2): kategori × cabang. Hanya untuk pengguna yang boleh memasang subsidi (label sensitif). */
function SubsidyCard({ subs: list, branches, edit, onEdit }: { subs: any[]; branches: any[]; edit: boolean; onEdit: (x: any) => void }) {
  const used = (x: any) => x.holders.reduce((a: number, h: any) => a + h.n, 0);
  const type = (x: any) => (x.kind === 'DISKON' ? `Diskon ${x.percent}%` : x.kind === 'STANDAR' ? 'Tarif standar' : KIND.TARIF);
  // baris Reguler = santri tanpa subsidi (tarif standar cabang / tarif khusus); nominal diatur di kartu Tarif per cabang
  const reguler = {
    id: 'reguler',
    name: 'Reguler',
    kind: 'STANDAR',
    isActive: true,
    isSibling: false,
    rates: branches.map((b) => ({ branchId: b.id, available: true, amount: b.sppStandard })),
    holders: [{ n: branches.reduce((a, b) => a + b.santri, 0) - list.reduce((a, x) => a + used(x), 0) }],
  };
  const subs = [reguler, ...list];
  const isReg = (x: any) => x.id === 'reguler';
  return (
    <Card
      pad={false}
      title={
        <span className="flex items-center gap-3">
          <IconTile icon={BadgePercent} tone={4} />
          Tarif SPP
        </span>
      }
      action={
        edit && (
          <button className="btn-secondary !h-10" onClick={() => onEdit('new')}>
            <Plus size={16} /> Kategori
          </button>
        )
      }
    >
      <p className="px-4 md:px-5 -mt-1 mb-3 text-sm text-n-600">
        Hanya berlaku untuk SPP. Satu santri satu subsidi; pilihan di form santri hanya kategori yang tersedia di cabangnya. Label kategori rahasia (tidak tampil ke Manajer & wali).
      </p>
      <div className="hidden md:block scroll-x">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th pl-5">Kategori</th>
              <th className="th">Tipe</th>
              {branches.map((b) => (
                <th key={b.id} className="th text-right">
                  {b.name}
                </th>
              ))}
              <th className="th text-right">Dipakai</th>
              {edit && <th className="th" />}
            </tr>
          </thead>
          <tbody>
            {subs.map((x) => (
              <tr key={x.id} className={x.isActive ? '' : 'opacity-60'}>
                <td className="td pl-5">
                  <div className="font-semibold">{x.name}</div>
                  {x.isSibling && <div className="text-xs text-n-600">dicabut otomatis bila saudara tidak Aktif</div>}
                  {isReg(x) && <div className="text-xs text-n-600">tanpa subsidi · ubah di Tarif per cabang</div>}
                  {!x.isActive && <div className="text-xs text-n-600">Nonaktif</div>}
                </td>
                <td className="td text-sm">{type(x)}</td>
                {branches.map((b) => {
                  const r = cell(x, b);
                  return (
                    <td key={b.id} className="td text-right">
                      {r ? (
                        <>
                          <div className="num">{rupiah(r.amount)}</div>
                          {r.note && <div className="text-xs text-n-600">{r.note}</div>}
                        </>
                      ) : (
                        <span className="text-n-600">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="td text-right">{used(x)} santri</td>
                {edit && (
                  <td className="td text-right pr-5">
                    {!isReg(x) && (
                      <button className="btn-text !h-9" onClick={() => onEdit(x)}>
                        Ubah
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="md:hidden px-4 pb-4 space-y-3">
        {subs.map((x) => (
          <div key={x.id} className={`p-4 rounded-2xl bg-n-50 ${x.isActive ? '' : 'opacity-60'}`}>
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-semibold">
                  {x.name}
                  {!x.isActive && ' · Nonaktif'}
                </div>
                <div className="text-xs text-n-600">
                  {type(x)} · dipakai {used(x)} santri{isReg(x) && ' · ubah di Tarif per cabang'}
                </div>
              </div>
              {edit && !isReg(x) && (
                <button className="btn-secondary !h-11" onClick={() => onEdit(x)}>
                  Ubah
                </button>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 mt-3 text-sm">
              {branches.map((b) => {
                const r = cell(x, b);
                return (
                  <div key={b.id} className="flex justify-between gap-2">
                    <span className="text-n-600">{b.name}</span>
                    <b className="font-semibold">{r ? rupiah(r.amount) : '—'}</b>
                  </div>
                );
              })}
            </div>
            {x.rates.some((r: any) => r.available && r.note) && (
              <div className="text-xs text-n-600 mt-2">
                {x.rates
                  .filter((r: any) => r.available && r.note)
                  .map((r: any) => `${branches.find((b) => b.id === r.branchId)?.name}: ${r.note}`)
                  .join(' · ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function SubsidyDialog({ x, branches, onClose }: { x: any; branches: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const isNew = x === 'new';
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!x) return;
    setErr('');
    const r = (b: any) => (isNew ? null : x.rates.find((y: any) => y.branchId === b.id));
    setF({
      name: isNew ? '' : x.name,
      kind: isNew ? 'TARIF' : x.kind,
      percent: isNew ? 50 : (x.percent ?? 50),
      isSibling: isNew ? false : x.isSibling,
      isActive: isNew ? true : x.isActive,
      applyToStudents: false,
      rates: branches.map((b) => ({ branchId: b.id, available: isNew ? true : !!r(b)?.available, amount: r(b)?.available && x.kind === 'TARIF' ? r(b).amount : '', note: r(b)?.note ?? '' })),
    });
  }, [x]);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        name: f.name.trim(),
        percent: f.kind === 'DISKON' ? Number(f.percent) : undefined,
        rates: f.rates.map((r: any) => ({
          branchId: r.branchId,
          available: r.available,
          amount: f.kind === 'TARIF' && r.available && r.amount !== '' ? Number(r.amount) : undefined,
          note: r.note || undefined,
        })),
      };
      if (isNew) {
        delete body.applyToStudents;
        delete body.isActive;
      }
      return isNew ? post('/subsidies', body) : patch(`/subsidies/${x.id}`, body);
    },
    onSuccess: (d: any) => {
      toast(d?.santriDiubah ? `Subsidi tersimpan · ${d.santriDiubah} santri ikut diperbarui` : 'Subsidi tersimpan');
      qc.invalidateQueries({ queryKey: ['subsidies'] });
      qc.invalidateQueries({ queryKey: ['settings'] });
      onClose();
    },
    onError: (e: any) => setErr(e.details?.join(', ') ?? e.message),
  });
  if (!x || !f) return null;
  const used = isNew ? 0 : x.holders.reduce((a: number, h: any) => a + h.n, 0);
  const setRate = (i: number, k: string, v: any) => setF({ ...f, rates: f.rates.map((r: any, j: number) => (j === i ? { ...r, [k]: v } : r)) });
  const preview = (b: any) => Math.round((b.sppStandard * (100 - (Number(f.percent) || 0))) / 100);
  return (
    <Dialog open onClose={onClose} title={isNew ? 'Kategori subsidi baru' : `Subsidi ${x.name}`} width="max-w-2xl">
      <div className="space-y-4">
        {err && <Alert>{err}</Alert>}
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Nama kategori" hint={!isNew && used ? 'Mengganti nama ikut mengganti label di data santri.' : undefined}>
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="mis. Yatim" />
          </Field>
          <Field label="Tipe" hint={!isNew && used ? 'Tipe tidak bisa diganti selama masih dipakai santri.' : undefined}>
            <Segmented
              label="Tipe subsidi"
              value={f.kind}
              onChange={(v) => (isNew || !used) && setF({ ...f, kind: v })}
              items={[
                { value: 'TARIF', label: 'Tarif pengganti' },
                { value: 'DISKON', label: 'Diskon %' },
              ]}
            />
          </Field>
        </div>
        {f.kind === 'DISKON' && (
          <Field label="Persen diskon dari tarif standar cabang" hint="mis. 50 untuk saudara">
            <input type="number" inputMode="numeric" min={1} max={100} className="input" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} />
          </Field>
        )}
        <div>
          <div className="label">Cabang yang menyediakan</div>
          <div className="space-y-2">
            {branches.map((b, i) => {
              const r = f.rates[i];
              return (
                <div key={b.id} className="grid grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[150px_150px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 p-3 rounded-2xl bg-n-50">
                  <label className="flex items-center gap-2.5 min-h-[44px] font-semibold text-sm">
                    <input type="checkbox" className="w-5 h-5 accent-brand-600" checked={r.available} onChange={(e) => setRate(i, 'available', e.target.checked)} />
                    {b.name}
                  </label>
                  {f.kind === 'TARIF' ? (
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1000}
                      className="input"
                      aria-label={`Tarif ${b.name}`}
                      disabled={!r.available}
                      value={r.amount}
                      onChange={(e) => setRate(i, 'amount', e.target.value)}
                      placeholder="Rp"
                    />
                  ) : (
                    <div className="text-sm text-n-700">
                      {r.available ? (
                        <>
                          {rupiah(preview(b))} <span className="text-n-600">dari {rupiah(b.sppStandard)}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </div>
                  )}
                  <input
                    className="input col-span-2 sm:col-span-1"
                    aria-label={`Catatan ${b.name}`}
                    disabled={!r.available}
                    value={r.note}
                    onChange={(e) => setRate(i, 'note', e.target.value)}
                    placeholder="Catatan (opsional), mis. hanya santri pindahan"
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="font-semibold text-sm">Diskon saudara</div>
            <div className="text-xs text-n-600">
              Butuh saudara Aktif saat dipasang. Bila pemegang yang Aktif tinggal kurang dari dua (cuti/keluar), semua pemegang di keluarga itu kembali ke tarif standar mulai tagihan berikutnya.
            </div>
          </div>
          <Toggle label="Diskon saudara" checked={f.isSibling} onChange={(v) => setF({ ...f, isSibling: v })} />
        </div>
        {!isNew && (
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="font-semibold text-sm">Aktif</div>
              <div className="text-xs text-n-600">Kategori nonaktif tidak bisa dipilih lagi. Hanya bisa dinonaktifkan bila tidak dipakai santri.</div>
            </div>
            <Toggle label="Kategori aktif" checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} />
          </div>
        )}
        {!isNew && used > 0 && (
          <label className="flex items-start gap-3 p-3.5 rounded-2xl bg-white shadow-soft text-sm">
            <input type="checkbox" className="w-5 h-5 mt-0.5 accent-brand-600" checked={f.applyToStudents} onChange={(e) => setF({ ...f, applyToStudents: e.target.checked })} />
            <span>
              Terapkan tarif baru juga ke <b>{used} santri</b> yang memakai kategori ini. Berlaku mulai tagihan SPP berikutnya.
            </span>
          </label>
        )}
        <Alert kind="info">Tagihan yang sudah terbit tetap memakai nominal lama.</Alert>
        <div className="flex gap-3">
          <button className="btn-soft flex-1" onClick={onClose}>
            Batal
          </button>
          <button className="btn-primary flex-1" disabled={save.isPending} onClick={() => save.mutate()}>
            Simpan subsidi
          </button>
        </div>
      </div>
    </Dialog>
  );
}
