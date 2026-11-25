import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowLeftRight, BookOpen, CalendarCheck, CheckCircle2, Hourglass, Lock, LogOut, Pause, Receipt, UserCheck, Users, Wallet } from 'lucide-react';
import { can, get, todayWIB } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Avatar, Bar, Card, COLOR, Empty, Ring, SearchBox, Stat } from '../components/ui';
import { addDaysYmd, jam, kategori, rentang } from './Agenda';
import KeuanganBox from '../components/KeuanganBox';

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const ROLE: Record<string, string> = { PJ: 'PJ RTA', USTADZAH: 'Ustadzah', MANAJER: 'Manajer', WALI: 'Wali Santri' };
/** Kalender bulan berjalan: hari ini, tgl 1 (tagihan terbit), tgl 10 (pengingat SPP) dan hari yang punya agenda ditandai */
function Kalender({ marks = {} }: { marks?: Record<number, { dot: string; titles: string[] }> }) {
  const now = new Date();
  const y = now.getFullYear(),
    m = now.getMonth();
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h2 className="h2">
          {BULAN[m]} {y}
        </h2>
        <span className="text-xs text-n-600">hari ini {now.getDate()}</span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-n-600 mb-1">
        {['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) =>
          d === null ? (
            <span key={i} />
          ) : (
            <span
              key={i}
              aria-label={`${d}${d === 1 ? ', tagihan SPP terbit' : d === 10 ? ', pengingat SPP' : ''}${marks[d] ? `, agenda: ${marks[d].titles.join(', ')}` : ''}`}
              className={`relative h-9 rounded-xl flex items-center justify-center text-[13px] font-semibold ${d === now.getDate() ? 'bg-brand-600 text-white' : d === 1 ? 'bg-butter-bg text-butter-fg' : d === 10 ? 'bg-lilac-bg text-lilac-fg' : 'text-n-800'}`}
            >
              {d}
              {marks[d] && <span aria-hidden className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${d === now.getDate() ? 'bg-white' : marks[d].dot}`} />}
            </span>
          ),
        )}
      </div>
    </div>
  );
}
const BAR_COLORS = ['#ad1d8e', '#8b74d9', '#5fb38a', '#f2c766', '#e05cc4', '#4b33b5', '#1f7a4d', '#d9a52f'];

/** Grafik batang tegak sederhana (santri aktif per cabang / per kelas) */
function VBars({ items, unit }: { items: { label: string; value: number }[]; unit: string }) {
  if (items.length === 0) return <Empty text="Belum ada santri aktif." />;
  const max = Math.max(...items.map((x) => x.value), 1);
  return (
    <div role="img" aria-label={items.map((x) => `${x.label} ${x.value} ${unit}`).join(', ')}>
      <div className="flex items-end justify-around h-52 border-b border-n-100 gap-3" aria-hidden>
        {items.map((b, i) => (
          <div key={b.label} className="flex flex-col items-center justify-end gap-2 flex-1 min-w-0 h-full">
            <b className="num text-sm">{b.value}</b>
            <div className="w-full max-w-[48px] rounded-t-2xl rounded-b-md" style={{ height: `${(b.value / max) * 160}px`, minHeight: 4, background: BAR_COLORS[i % BAR_COLORS.length] }} />
          </div>
        ))}
      </div>
      <div className="flex justify-around text-xs text-n-600 mt-2 gap-3" aria-hidden>
        {items.map((b) => (
          <span key={b.label} className="flex-1 min-w-0 text-center truncate">
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [branchId, setBranchId] = useState('');
  const [cari, setCari] = useState('');
  const q = useQuery({ queryKey: ['dashboard', branchId], queryFn: () => get(`/dashboard${branchId ? `?branchId=${branchId}` : ''}`) });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => get('/branches'), enabled: !user?.branchIds });
  const prof = useQuery({ queryKey: ['profile'], queryFn: () => get('/auth/profile') });
  // agenda bulan berjalan + 45 hari ke depan (kalender & agenda terdekat); sesuai filter cabang
  const today = todayWIB();
  const agFrom = `${today.slice(0, 7)}-01`,
    agTo = addDaysYmd(today, 45);
  const ag = useQuery({
    queryKey: ['agenda', 'dashboard', branchId, agFrom],
    enabled: can(user, 'agenda.lihat'),
    queryFn: () => get(`/agenda?from=${agFrom}&to=${agTo}${branchId ? `&branchId=${branchId}` : ''}`),
  });
  const d = q.data;
  const hari = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const scope = prof.data?.branches?.map((b: any) => b.name).join(', ');

  // Perlu tindakan: kotak per jenis (dikelompokkan, warna berbeda); kotak pengajuan & bukti tampil bila punya izin (count != null)
  const t = d?.tindakan;
  const tindakan = d
    ? ([
        t.count.mutasi != null && {
          key: 'mutasi',
          to: '/pengajuan',
          icon: ArrowLeftRight,
          bg: 'bg-rose-bg',
          fg: 'text-rose-fg',
          title: 'Pengajuan mutasi',
          n: t.count.mutasi,
          cta: 'Tinjau',
          list: true,
          lines: t.requests.filter((r: any) => r.type === 'MUTASI').map((r: any) => `${r.studentName} · ${r.branchName} → ${r.targetBranch ?? '-'}`),
        },
        t.count.keluar != null && {
          key: 'keluar',
          to: '/pengajuan',
          icon: LogOut,
          bg: 'bg-butter-bg',
          fg: 'text-butter-fg',
          title: 'Pengajuan keluar',
          n: t.count.keluar,
          cta: 'Tinjau',
          list: true,
          lines: t.requests.filter((r: any) => r.type === 'KELUAR').map((r: any) => `${r.studentName} · ${r.branchName}`),
        },
        t.count.bukti != null && {
          key: 'bukti',
          to: '/bayar?tab=bukti',
          icon: Receipt,
          bg: 'bg-mint-bg',
          fg: 'text-mint-fg',
          title: 'Bukti bayar menunggu',
          n: t.count.bukti,
          cta: 'Tinjau',
          list: true,
          lines: t.payments.map((p: any) => `Kel. ${p.fatherName}${p.items ? ` · ${p.items}` : ''}`),
        },
        d.absensi?.belumHariIni?.length > 0 && {
          key: 'absensi',
          to: '/absensi',
          icon: CalendarCheck,
          bg: 'bg-rose-bg',
          fg: 'text-rose-fg',
          title: 'Absensi hari ini',
          n: d.absensi.belumHariIni.reduce((a: number, c: any) => a + c.todo, 0),
          cta: 'Isi absensi',
          lines: d.absensi.belumHariIni.slice(0, 3).map((c: any) => `${c.name}: ${c.todo} santri belum diabsen`),
        },
        d.hafalan?.belumInputPekanIni > 0 && {
          key: 'hafalan',
          to: '/kelas',
          icon: BookOpen,
          bg: 'bg-lilac-bg',
          fg: 'text-lilac-fg',
          title: 'Input hafalan pekanan',
          n: d.hafalan.belumInputPekanIni,
          cta: 'Mulai input',
          lines: [`${d.hafalan.belumInputPekanIni} santri belum diinput pekan ini`],
        },
        d.keuangan?.keluargaBelum > 0 && {
          key: 'belum',
          to: '/bayar',
          icon: Wallet,
          bg: 'bg-danger-bg',
          fg: 'text-danger-fg',
          title: 'Keluarga belum bayar',
          n: d.keuangan.keluargaBelum,
          cta: 'Buka Bayar',
          lines: ['Kirim pengingat tagihan via WhatsApp'],
        },
      ].filter(Boolean) as any[])
    : [];

  const perBranch = d
    ? (Object.values(
        d.perBranch.reduce((a: any, r: any) => {
          a[r.branchId] ??= { label: r.branchName, value: 0 };
          if (r.status === 'AKTIF') a[r.branchId].value += r.n;
          return a;
        }, {}),
      ) as any[])
    : [];
  const perClass = d ? d.perClass.map((c: any) => ({ label: c.className, value: c.n })) : [];
  const multiBranch = perBranch.length > 1;
  const k = d?.keuangan;
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const d10 = now.getDate() < 10 ? new Date(now.getFullYear(), now.getMonth(), 10) : new Date(now.getFullYear(), now.getMonth() + 1, 10);
  const fmtD = (x: Date) => `${x.getDate()} ${BULAN[x.getMonth()].slice(0, 3)}`;
  const agRows: any[] = ag.data?.rows ?? [];
  const upcoming = agRows
    .filter((a) => a.endDate >= today)
    .slice(0, 4)
    .map((a) => ({
      key: `ag-${a.id}`,
      when: rentang({ startDate: a.startDate < today ? today : a.startDate, endDate: a.startDate < today ? today : a.startDate }),
      tag: `${kategori(a.category).label} · ${a.branchName ?? 'Semua cabang'}${jam(a) ? ` · ${jam(a)}` : ''}`,
      title: a.title,
      bg: kategori(a.category).bg,
    }));
  const agenda = [
    d?.hafalan?.belumInputPekanIni > 0 && { key: 'hafalan', when: 'Pekan ini', tag: 'Hafalan', title: `Input hafalan: ${d.hafalan.belumInputPekanIni} santri belum`, bg: 'bg-rose-bg' },
    ...upcoming,
    k && { key: 'spp10', when: fmtD(d10), tag: 'SPP', title: 'Pengingat tagihan ke wali', bg: 'bg-lilac-bg' },
    k && { key: 'spp1', when: fmtD(nextMonth), tag: 'SPP', title: `Tagihan SPP ${BULAN[nextMonth.getMonth()]} terbit otomatis`, bg: 'bg-butter-bg' },
  ].filter(Boolean) as any[];
  // titik agenda di kalender bulan berjalan
  const marks: Record<number, { dot: string; titles: string[] }> = {};
  for (const a of agRows)
    for (let x = a.startDate < agFrom ? agFrom : a.startDate; x <= a.endDate && x.startsWith(agFrom.slice(0, 7)); x = addDaysYmd(x, 1)) {
      const dd = Number(x.slice(8));
      (marks[dd] ??= { dot: kategori(a.category).dot, titles: [] }).titles.push(a.title);
    }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <h1 className="h1">
            Assalamu'alaikum, <span className="text-brand-600">{user?.name}</span>
          </h1>
          <div className="text-sm text-n-600 mt-1">{hari} · Semoga hari ini penuh berkah</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {can(user, 'santri.lihat') && (
            <form
              className="flex-1 sm:w-64"
              onSubmit={(e) => {
                e.preventDefault();
                navigate(`/santri${cari.trim() ? `?q=${encodeURIComponent(cari.trim())}` : ''}`);
              }}
            >
              <SearchBox value={cari} onChange={setCari} placeholder="Cari santri" />
            </form>
          )}
          {user?.branchIds ? (
            <span className="pill h-9 px-4 bg-white text-brand-800 shadow-chip">
              <Lock size={13} />
              {scope || 'Cabang Anda'}
            </span>
          ) : (
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
      </header>

      {!d ? (
        <div className="text-sm text-n-600">Memuat…</div>
      ) : (
        <div className="grid xl:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
          <div className="space-y-6 min-w-0">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat filled icon={Users} tone={0} value={d.santri.aktif} label="Santri aktif" />
              <Stat filled icon={Pause} tone={1} value={d.santri.cuti} label="Santri cuti" />
              <Stat filled icon={Hourglass} tone={2} value={d.santri.indent} label="Santri indent" />
              {k ? (
                <Stat filled icon={CheckCircle2} tone={3} value={`${k.lunasSantri}/${k.totalSantri}`} label="Sudah bayar SPP bulan ini" />
              ) : (
                <Stat filled icon={UserCheck} tone={3} value={d.ustadzahAktif} label="Ustadzah aktif" />
              )}
            </div>

            <div className="grid lg:grid-cols-3 gap-4">
              <Card title="Santri aktif">
                <div className="flex flex-col items-center gap-4">
                  <Ring
                    size={168}
                    stroke={20}
                    label={`${d.santri.aktif} santri aktif: ${d.santri.putri} putri, ${d.santri.putra} putra`}
                    center={d.santri.aktif}
                    sub="santri aktif"
                    segments={[
                      { value: d.santri.putri, color: COLOR.brand },
                      { value: d.santri.putra, color: COLOR.menunggu },
                    ]}
                  />
                  <div className="flex justify-center gap-6 text-sm">
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLOR.brand }} aria-hidden />
                      Putri <b className="num">{d.santri.putri}</b>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLOR.menunggu }} aria-hidden />
                      Putra <b className="num">{d.santri.putra}</b>
                    </span>
                  </div>
                </div>
              </Card>
              <Card title={multiBranch ? 'Santri aktif per cabang' : 'Santri aktif per kelas'} className="lg:col-span-2">
                <VBars items={multiBranch ? perBranch : perClass} unit="santri aktif" />
              </Card>
            </div>

            <div className={`grid gap-4 ${d.finance ? 'lg:grid-cols-2 items-start' : 'lg:grid-cols-3'}`}>
              <Card title="Capaian hafalan per kelas" className={d.finance ? '' : 'lg:col-span-2'}>
                {d.hafalan.perClass.length === 0 ? (
                  <Empty text="Belum ada kelas." />
                ) : (
                  <div className="space-y-4">
                    {d.hafalan.perClass.map((c: any, i: number) => (
                      <div key={c.classId}>
                        <div className="flex justify-between text-sm mb-2">
                          <span className="font-semibold">{c.className}</span>
                          <b className="num">{c.avg}%</b>
                        </div>
                        <Bar value={c.avg} color={BAR_COLORS[i % BAR_COLORS.length]} label={`${c.className} rata-rata ${c.avg}%`} />
                      </div>
                    ))}
                  </div>
                )}
              </Card>
              {d.finance ? (
                <KeuanganBox key={branchId} f={d.finance} />
              ) : (
                <Card title="Santri per status">
                  <div className="flex flex-col items-center gap-4">
                    <Ring
                      size={120}
                      label="Komposisi status santri"
                      center={d.santri.total}
                      sub="santri"
                      segments={[
                        { value: d.santri.aktif, color: COLOR.lunas },
                        { value: d.santri.cuti, color: COLOR.belum },
                        { value: d.santri.indent, color: COLOR.menunggu },
                      ]}
                    />
                    <div className="text-sm flex gap-4">
                      <span>
                        Aktif <b>{d.santri.aktif}</b>
                      </span>
                      <span>
                        Cuti <b>{d.santri.cuti}</b>
                      </span>
                      <span>
                        Indent <b>{d.santri.indent}</b>
                      </span>
                    </div>
                  </div>
                </Card>
              )}
            </div>

            <Card
              title="Perlu tindakan"
              action={
                can(user, 'pengajuan.lihat') && (
                  <Link to="/pengajuan" className="text-sm font-semibold text-brand-700 underline underline-offset-2">
                    Lihat semua
                  </Link>
                )
              }
            >
              {tindakan.length === 0 ? (
                <Empty icon={CheckCircle2} text="Alhamdulillah, tidak ada yang perlu ditindaklanjuti saat ini." />
              ) : (
                <div className="flex gap-3 overflow-x-auto -mx-4 px-4 pb-1 md:mx-0 md:px-0 md:grid md:grid-cols-2 xl:grid-cols-3">
                  {tindakan.map((t) => (
                    <div key={t.key} className={`${t.bg} rounded-card p-4 flex flex-col gap-3 shrink-0 w-[260px] md:w-auto`}>
                      <div className="flex items-center gap-3">
                        <span className={`bg-white ${t.fg} rounded-[12px] w-10 h-10 inline-flex items-center justify-center shrink-0`}>
                          <t.icon size={18} aria-hidden />
                        </span>
                        <div className="font-bold text-sm leading-snug flex-1 min-w-0">{t.title}</div>
                        <span className={`min-w-[28px] h-7 px-2 rounded-full bg-white ${t.fg} text-xs font-extrabold flex items-center justify-center`} aria-label={`${t.n} menunggu`}>
                          {t.n}
                        </span>
                      </div>
                      <div className="text-xs text-n-700 flex-1 space-y-1 min-w-0">
                        {t.n === 0 ? (
                          <div className="text-n-600">Tidak ada yang menunggu</div>
                        ) : (
                          <>
                            {t.lines.map((l: string) => (
                              <div key={l} className="truncate">
                                {l}
                              </div>
                            ))}
                            {t.list && t.n > t.lines.length && <div className="text-n-600">+{t.n - t.lines.length} lainnya</div>}
                          </>
                        )}
                      </div>
                      {t.n > 0 && (
                        <Link to={t.to} className="btn !h-11 md:!h-9 px-5 self-start bg-white text-n-900">
                          {t.cta}
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
          <aside className="space-y-4">
            <Link to="/profil" className="card p-4 flex items-center gap-3">
              <Avatar name={user?.name ?? ''} size={48} />
              <div className="flex-1 min-w-0">
                <div className="font-bold truncate">{user?.name}</div>
                <div className="text-xs text-n-600 truncate">
                  {ROLE[user?.role ?? ''] ?? user?.role}
                  {scope ? ` · ${scope}` : ''}
                </div>
              </div>
              <span className="text-n-400 text-xl">›</span>
            </Link>
            <Card>
              <Kalender marks={marks} />
            </Card>
            {(agenda.length > 0 || can(user, 'agenda.input')) && (
              <Card
                title="Agenda"
                action={
                  can(user, 'agenda.lihat') && (
                    <Link to="/agenda" className="text-sm font-semibold">
                      {can(user, 'agenda.input') ? 'Atur' : 'Semua'}
                    </Link>
                  )
                }
              >
                {agenda.length === 0 ? (
                  <Empty text="Belum ada agenda terdekat." />
                ) : (
                  <div className="space-y-2.5">
                    {agenda.map((a) => (
                      <div key={a.key} className={`flex items-center gap-3 px-3.5 py-3 rounded-2xl ${a.bg}`}>
                        <b className="font-display text-[13px] w-14 shrink-0">{a.when}</b>
                        <div className="min-w-0">
                          <div className="text-xs text-n-700 truncate">{a.tag}</div>
                          <div className="text-sm font-semibold">{a.title}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}
            <Card
              title="Progres hafalan terbaik"
              action={
                <Link to="/kelas" className="text-sm font-semibold">
                  Kelas
                </Link>
              }
            >
              {d.hafalan.top.length === 0 ? (
                <Empty text="Belum ada catatan hafalan." />
              ) : (
                <div className="space-y-3.5">
                  {d.hafalan.top.map((t: any) => (
                    <Link key={t.id} to={`/santri/${t.id}`} className="flex items-center gap-3">
                      <Avatar name={t.fullName} size={40} />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">{t.fullName}</div>
                        <div className="text-xs text-n-600">{t.className}</div>
                        <div className="mt-1.5">
                          <Bar value={t.percent} h={6} />
                        </div>
                      </div>
                      <b className="num">{Math.round(t.percent)}%</b>
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
