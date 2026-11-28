import ExcelJS from 'exceljs';
const B = process.env.API_URL ?? 'http://localhost:3000';
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
/**
 * Uji end-to-end API: scope cabang, izin, hafalan, SPP & bayar, halaman wali, LPS, akun wali (portal), mutasi, pengaturan, profil.
 * Jalankan di database bersih:  bun run db:reset  →  bun run api  →  bun run test:e2e
 * Akun seed (password Rta12345, wajib ganti) otomatis diganti ke TEST_PASSWORD saat login pertama.
 */
const SEED_PW = process.env.SEED_PASSWORD ?? 'Rta12345';
const TEST_PW = process.env.TEST_PASSWORD ?? 'Rta12345x';
/** fetch yang menunggu lalu mengulang bila kena batas request (429): uji ini mengirim ratusan request per menit dari satu IP. */
async function fetch429(url: string, init: any = {}, tries = 6): Promise<Response> {
  for (let k = 0; ; k++) {
    const r = await fetch(url, init);
    if (r.status !== 429 || k >= tries) return r;
    const wait = Math.min(65, Number(r.headers.get('retry-after')) || 10);
    console.log(`  … batas request tercapai, menunggu ${wait} detik`);
    await new Promise((res) => setTimeout(res, wait * 1000));
  }
}
async function rawLogin(email: string, password: string, ua = 'rta-e2e') {
  const r = await fetch429(B + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': ua }, body: JSON.stringify({ email, password }) });
  return { r, j: (await r.json()) as any, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
/** Login dengan TEST_PW; bila belum pernah, login dengan password seed lalu ganti (sesi dari ganti password dipakai langsung: hemat kuota login 10/menit). */
async function login2(email: string) {
  const a = await rawLogin(email, TEST_PW, 'Mozilla/5.0 (Android 14) Chrome/120');
  if (a.r.status === 401) {
    const b = await rawLogin(email, SEED_PW);
    if (!b.j.accessToken) throw new Error(`Login ${email} gagal: ${b.j.message}. Jalankan "bun run db:reset" dulu.`);
    const c = await fetch(B + '/auth/change-password', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + b.j.accessToken, cookie: b.cookie }, body: JSON.stringify({ oldPassword: SEED_PW, newPassword: TEST_PW }) });
    const cj = (await c.json()) as any;
    if (!cj.accessToken) throw new Error(`Ganti password ${email} gagal: ${cj.message}`);
    return { tok: cj.accessToken as string, cookie: (c.headers.get('set-cookie') || '').split(';')[0] };
  }
  if (!a.j.accessToken) throw new Error(`Login ${email} gagal: ${a.j.message}`);
  return { tok: a.j.accessToken as string, cookie: a.cookie };
}
const api = (s: { tok: string; cookie?: string }) => async (path: string, opt: any = {}) => {
  const r = await fetch429(B + path, { ...opt, headers: { authorization: 'Bearer ' + s.tok, ...(s.cookie ? { cookie: s.cookie } : {}), ...(opt.body && !(opt.body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...(opt.headers || {}) } });
  const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { j = t; } return { s: r.status, j };
};
const pj = api(await login2('pj@rta.local'));
const us = api(await login2('ustadzah.spy@rta.local'));
const mn = api(await login2('manajer@rta.local'));

console.log('Hafalan');
let r = await us('/hafalan/classes'); ok(r.s === 200 && r.j.every((c: any) => c.branchName === 'Supriyadi'), `ustadzah hanya melihat kelas Supriyadi (${r.j.length} kelas)`);
const cls = r.j.find((c: any) => c.level === 'JUZ30');
r = await us(`/hafalan/classes/${cls.id}`); ok(r.s === 200 && r.j.rows.length > 0 && r.j.juzTotal === 564, `roster Juz 30: ${r.j.rows.length} santri, total juz 564`);
const target = r.j.rows.find((x: any) => x.status === 'AKTIF');
r = await us('/hafalan/classes/1'); ok(r.s === 404, 'kelas cabang lain ditolak (404)');
const sur = (await us('/hafalan/surahs?level=JUZ30')).j; const takwir = sur.find((s: any) => s.name === 'At-Takwir');
r = await us('/hafalan/records', { method: 'POST', body: JSON.stringify({ studentId: target.id, surahId: takwir.id, ayat: 30 }) }); ok(r.s === 400, 'ayat melebihi jumlah ayat surah ditolak: ' + r.j.message);
r = await us('/hafalan/records', { method: 'POST', body: JSON.stringify({ studentId: target.id, surahId: takwir.id, ayat: 20 }) });
if (r.s === 409) { ok(true, 'posisi turun → minta konfirmasi'); r = await us('/hafalan/records', { method: 'POST', body: JSON.stringify({ studentId: target.id, surahId: takwir.id, ayat: 20, confirmLower: true }) }); }
ok(r.s === 201 && r.j.total === 148 && r.j.percent === 26.2, `rumus PRD: At-Takwir 20 → ${r.j.total} ayat = ${r.j.percent}%`);
r = await mn('/hafalan/records', { method: 'POST', body: JSON.stringify({ studentId: target.id, surahId: takwir.id, ayat: 21 }) }); ok(r.s === 403, 'manajer tidak bisa input hafalan');

console.log('Absensi');
r = await us('/absensi/classes'); ok(r.s === 200 && r.j.length > 0 && r.j.every((c: any) => c.branchName === 'Supriyadi'), `ustadzah hanya melihat kelas Supriyadi (${r.j.length} kelas)`);
const acls = r.j.find((c: any) => c.level === 'JUZ30');
const pjCls = (await pj('/absensi/classes')).j; ok(new Set(pjCls.map((c: any) => c.branchName)).size === 4, 'PJ melihat kelas semua cabang');
const lainCls = pjCls.find((c: any) => c.branchName !== 'Supriyadi');
r = await us(`/absensi/day?classId=${lainCls.id}`); ok(r.s === 404, 'absensi kelas cabang lain ditolak (404)');
const ymdWIB = (k: number) => new Date(Date.now() + 7 * 3600_000 - k * 86400_000).toISOString().slice(0, 10);
let aday: any = null;
for (let k = 0; k < 21 && !aday; k++) { const x = (await us(`/absensi/day?classId=${acls.id}&date=${ymdWIB(k)}`)).j; if (x.kind === 'BELAJAR') aday = x; }
ok(!!aday && aday.editable, `hari belajar terakhir ditemukan: ${aday?.date}`);
const aAct = aday.rows.filter((x: any) => x.status === 'AKTIF');
const aEntries = aAct.map((x: any, i: number) => ({ studentId: x.id, status: i === 0 ? 'A' : i === 1 ? 'I' : 'H', ...(i === 1 ? { note: 'Acara keluarga' } : {}) }));
r = await us(`/absensi/day?classId=${lainCls.id}&date=${aday.date}`); ok(r.s === 404, 'ustadzah tidak bisa membuka hari absensi cabang lain');
r = await us('/absensi/day', { method: 'PUT', body: JSON.stringify({ classId: lainCls.id, date: aday.date, entries: aEntries }) }); ok(r.s === 404, 'ustadzah tidak bisa menyimpan absensi cabang lain (404)');
r = await us('/absensi/day', { method: 'PUT', body: JSON.stringify({ classId: acls.id, date: aday.date, entries: aEntries }) });
ok(r.s === 200 && r.j.changed === aEntries.length && r.j.summary.A === 1 && r.j.summary.I === 1, `ustadzah menyimpan absensi ${aEntries.length} santri`);
r = await us('/absensi/day', { method: 'PUT', body: JSON.stringify({ classId: acls.id, date: aday.date, entries: aEntries }) }); ok(r.s === 200 && r.j.changed === 0, 'simpan ulang tanpa perubahan tidak menulis apa pun');
r = await us('/absensi/day', { method: 'PUT', body: JSON.stringify({ classId: acls.id, date: aday.date, entries: [{ studentId: aAct[0].id, status: 'X' }] }) }); ok(r.s === 400, 'status selain H/I/S/A ditolak');
r = await us('/absensi/day', { method: 'PUT', body: JSON.stringify({ classId: acls.id, date: ymdWIB(-3), entries: [{ studentId: aAct[0].id, status: 'H' }] }) }); ok(r.s === 400, 'tanggal yang belum lewat ditolak');
let sat = ymdWIB(1); for (let k = 1; new Date(sat + 'T00:00:00Z').getUTCDay() !== 6; k++) sat = ymdWIB(k);
r = await us('/absensi/day', { method: 'PUT', body: JSON.stringify({ classId: acls.id, date: sat, entries: [{ studentId: aAct[0].id, status: 'H' }] }) }); ok(r.s === 400, 'hari Sabtu (libur) ditolak: ' + r.j.message);
const aCuti = aday.rows.find((x: any) => x.status === 'CUTI');
if (aCuti) { r = await us('/absensi/day', { method: 'PUT', body: JSON.stringify({ classId: acls.id, date: aday.date, entries: [{ studentId: aCuti.id, status: 'H' }] }) }); ok(r.s === 400, 'santri cuti tidak bisa diabsen'); }
r = await mn('/absensi/day', { method: 'PUT', body: JSON.stringify({ classId: acls.id, date: aday.date, entries: aEntries }) }); ok(r.s === 403, 'manajer tidak bisa mengisi absensi');
r = await mn(`/absensi/day?classId=${acls.id}&date=${aday.date}`); ok(r.s === 200 && r.j.rows.find((x: any) => x.id === aAct[1].id).note === 'Disembunyikan', 'keterangan izin dimasking untuk manajer');
r = await us(`/absensi/recap?classId=${acls.id}&month=${aday.date.slice(0, 7)}`);
const aRow = r.j.rows.find((x: any) => x.id === aAct[0].id); const dIdx = Number(aday.date.slice(8)) - 1;
ok(r.s === 200 && aRow.cells[dIdx] === 'A' && aRow.counts.A >= 1 && r.j.days.length >= 28, `rekap bulanan: ${r.j.label}, ${r.j.meetings} pertemuan, alpa tercatat`);
ok(r.j.days.every((d: any) => d.kind !== 'BELAJAR' || ![6, 0].includes(new Date(d.date + 'T00:00:00Z').getUTCDay())), 'Sabtu & Ahad tidak dihitung sebagai hari belajar');
r = await us(`/absensi/students/${aAct[0].id}?month=${aday.date.slice(0, 7)}`);
ok(r.s === 200 && !!r.j.wa && r.j.wa.waUrl.startsWith('https://wa.me/62') && r.j.wa.message.includes('/perkembangan') && !/Yatim|subsidi/i.test(r.j.wa.message), 'pesan WA wali dibuat (tanpa kategori subsidi)');
r = await mn(`/absensi/students/${aAct[0].id}?month=${aday.date.slice(0, 7)}`); ok(r.s === 200 && r.j.wa === null, 'manajer tidak mendapat link WA (no. WA sensitif)');
r = await us(`/absensi/students/${aAct[0].id}/wa`, { method: 'POST' }); ok(r.s === 201, 'kabari wali tercatat di audit');
r = await us(`/absensi/export.xlsx?classId=${acls.id}&month=${aday.date.slice(0, 7)}`); ok(r.s === 200, 'ekspor Excel absensi');
r = await mn(`/absensi/export.pdf?classId=${acls.id}&month=${aday.date.slice(0, 7)}`); ok(r.s === 200, 'manajer bisa ekspor PDF absensi');
r = await pj('/absensi/day', { method: 'PUT', body: JSON.stringify({ classId: acls.id, date: aday.date, entries: [{ studentId: aAct[0].id, status: 'S', note: 'Demam' }] }) }); ok(r.s === 200 && r.j.changed === 1, 'PJ bisa mengubah absensi cabang mana pun');
r = await pj('/audit?entity=class'); ok(r.s === 200, 'perubahan absensi tercatat di audit log');
r = await pj('/settings', { method: 'PATCH', body: JSON.stringify({ attendanceDays: [] }) }); ok(r.s === 400, 'hari belajar kosong ditolak');
r = await pj('/settings', { method: 'PATCH', body: JSON.stringify({ attendanceWaTemplate: 'Ananda {nama} alpa {tanggal}' }) }); ok(r.s === 400, 'template WA absensi tanpa {link} ditolak');
r = await us('/dashboard'); ok(r.s === 200 && Array.isArray(r.j.absensi?.belumHariIni), 'Beranda memuat pengingat absensi');

console.log('SPP & Bayar');
r = await pj('/spp/summary'); ok(r.s === 200 && r.j.total > 0, `rekap SPP ${r.j.label}: ${JSON.stringify(r.j.counts)}`);
r = await us('/spp/students'); ok(r.s === 200 && r.j.rows.length > 0 && r.j.rows[0].hist.length === 6, `rekap per santri (scope ustadzah: ${r.j.rows.length}), riwayat 6 bulan`);
r = await us('/bayar/families'); ok(r.s === 200 && r.j.length > 0, `keluarga perlu ditagih: ${r.j.length}`);
const fam = r.j.find((f: any) => f.total > 0);
r = await us(`/bayar/families/${fam.id}/link`, { method: 'POST' }); ok(r.s === 201 && r.j.waUrl.startsWith('https://wa.me/62') && !/Yatim|subsidi/i.test(r.j.message), 'link WA dibuat, pesan tanpa kategori subsidi');
const token = r.j.url.split('/bayar/')[1];
r = await fetch(B + '/public/tagihan/' + token).then(async (x) => ({ s: x.status, j: await x.json() as any })); ok(r.s === 200 && r.j.total === fam.total && !JSON.stringify(r.j).includes('wa_phone'), `halaman wali: total ${r.j.total}, tanpa data sensitif`);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
let fd = new FormData(); fd.append('file', new Blob([new TextEncoder().encode('bukan gambar sama sekali')]), 'x.jpg');
r = await fetch(B + `/public/tagihan/${token}/bukti`, { method: 'POST', body: fd }).then(async (x) => ({ s: x.status, j: await x.json() as any })); ok(r.s === 400, 'file bukan gambar ditolak (cek isi, bukan ekstensi)');
fd = new FormData(); fd.append('file', new Blob([png]), 'bukti.png');
r = await fetch(B + `/public/tagihan/${token}/bukti`, { method: 'POST', body: fd }).then(async (x) => ({ s: x.status, j: await x.json() as any })); ok(r.s === 201, 'wali unggah bukti → menunggu verifikasi');
r = await fetch(B + '/public/tagihan/salah-token').then((x) => ({ s: x.status })); ok(r.s === 404, 'token salah ditolak');
r = await us('/bayar/payments?state=MENUNGGU'); const mine = r.j.find((p: any) => p.familyId === fam.id && p.source === 'WEB'); ok(!!mine && mine.hasProof, 'bukti wali muncul di antrean ustadzah');
r = await us(`/bayar/payments/${mine.id}/verify`, { method: 'POST' }); ok(r.s === 403, 'ustadzah tidak bisa verifikasi (butuh PJ)');
r = await pj(`/bayar/payments/${mine.id}/proof`); ok(r.s === 200, 'PJ bisa membuka file bukti');
r = await pj(`/bayar/payments/${mine.id}/verify`, { method: 'POST' }); ok(r.s === 201, 'PJ memverifikasi');
r = await pj(`/bayar/payments/${mine.id}/cancel`, { method: 'POST', body: JSON.stringify({}) }); ok(r.s === 400, 'batal tanpa alasan ditolak');
// catat tunai oleh ustadzah
const f2 = (await us('/bayar/families')).j.find((f: any) => f.total > 0 && f.id !== fam.id);
const inv = (await us(`/bayar/families/${f2.id}/invoices`)).j;
fd = new FormData(); fd.append('familyId', String(f2.id)); fd.append('invoiceIds', inv.map((i: any) => i.id).join(',')); fd.append('amount', String(inv.reduce((a: number, i: any) => a + i.amount, 0) - 1)); fd.append('paidAt', '2026-10-27'); fd.append('method', 'TUNAI');
r = await us('/bayar/payments', { method: 'POST', body: fd }); ok(r.s === 400, 'nominal tidak sama dengan tagihan ditolak');
fd.set('amount', String(inv.reduce((a: number, i: any) => a + i.amount, 0))); fd.append('matched', 'true');
r = await us('/bayar/payments', { method: 'POST', body: fd }); ok(r.s === 201 && r.j.state === 'MENUNGGU', 'tunai dicatat ustadzah → tetap menunggu verifikasi PJ');
r = await mn('/bayar/families'); ok(r.s === 200, 'manajer bisa melihat daftar bayar');
r = await mn(`/bayar/families/${fam.id}/link`, { method: 'POST' }); ok(r.s === 403, 'manajer tidak bisa kirim tagihan');

console.log('LPS');
r = await pj('/lps/generate', { method: 'POST', body: JSON.stringify({ period: new Date().toISOString().slice(0, 7) }) }); ok(r.s === 201 && r.j.created > 0, `draft LPS dibuat: ${r.j.created}`);
r = await pj('/lps'); const d = r.j.rows.find((x: any) => x.status === 'DRAFT'); ok(!!d && d.hafalanPercent != null, 'draft menarik hafalan otomatis');
r = await pj(`/lps/${d.id}/submit`, { method: 'POST' }); ok(r.s === 400, 'kirim tanpa nilai lengkap ditolak');
r = await pj(`/lps/${d.id}`, { method: 'PATCH', body: JSON.stringify({ scores: { BTQ: 'Sangat baik', Tahsin: 'Baik', Adab: 'Sangat baik', 'Doa harian': 'Perlu latihan' }, note: 'Semangat murajaah.' }) }); ok(r.s === 200, 'nilai diisi');
for (const a of ['submit', 'approve', 'publish']) { r = await pj(`/lps/${d.id}/${a}`, { method: 'POST' }); ok(r.s === 201, `${a} → ${r.j.status}`); }
r = await pj(`/lps/${d.id}/pdf`); ok(r.s === 200 && String(r.j).startsWith('%PDF'), 'PDF LPS terbit');
// kirim LPS ke WA wali: link bertoken (pola /bayar/:token), nomor wali otomatis
r = await pj(`/lps/${d.id}/wa`, { method: 'POST' });
ok(r.s === 201 && /^https:\/\/wa\.me\/62\d+\?text=/.test(r.j.waUrl) && /\/laporan\/[\w-]{20,}$/.test(r.j.url) && r.j.message.includes(r.j.url), 'kirim LPS ke WA: wa.me ke no. wali + link LPS di pesan');
ok(!/Reguler|Saudara|subsid/i.test(r.j.message), 'pesan WA LPS tanpa label subsidi');
const lpsTok1 = r.j.url.split('/laporan/')[1];
const pubLps = (p: string) => fetch429(B + p).then(async (x) => ({ s: x.status, t: await x.text(), type: x.headers.get('content-type') ?? '', disp: x.headers.get('content-disposition') ?? '' }));
let pl = await pubLps(`/public/lps/${lpsTok1}`); let pj1 = JSON.parse(pl.t);
ok(pl.s === 200 && !!pj1.who && !!pj1.periodLabel && !!pj1.expiresAt, `halaman LPS wali tanpa login: ${pj1.who}, ${pj1.periodLabel}`);
ok(!/waPhone|address|nis|scores|note|subsid|familyId/i.test(pl.t), 'info publik LPS hanya data minimum');
pl = await pubLps(`/public/lps/${lpsTok1}/pdf`); ok(pl.s === 200 && pl.t.startsWith('%PDF') && pl.disp.startsWith('attachment'), 'wali mengunduh PDF lewat link');
pl = await pubLps(`/public/lps/${lpsTok1}/pdf?view=1`); ok(pl.s === 200 && pl.disp.startsWith('inline'), 'wali melihat PDF di browser (inline)');
r = await pj('/lps'); ok(!!r.j.rows.find((x: any) => x.id === d.id)?.waSentAt, 'daftar LPS mencatat waktu terakhir dikirim');
r = await pj(`/lps/${d.id}/wa`, { method: 'POST' }); const lpsTok2 = r.j.url.split('/laporan/')[1];
pl = await pubLps(`/public/lps/${lpsTok1}`); ok(pl.s === 404, 'kirim ulang mencabut link lama (404)');
pl = await pubLps(`/public/lps/${lpsTok2}`); ok(pl.s === 200, 'link baru berlaku');
pl = await pubLps('/public/lps/token-ngawur-xxxxxxxxxxxxxxxx'); ok(pl.s === 404, 'token tidak dikenal ditolak (404)');
r = await mn(`/lps/${d.id}/wa`, { method: 'POST' }); ok(r.s === 403, 'manajer tidak bisa kirim LPS ke WA (no. wali sensitif)');
const lpsDraft = (await pj('/lps')).j.rows.find((x: any) => x.id && x.status !== 'TERBIT');
r = await pj(`/lps/${lpsDraft.id}/wa`, { method: 'POST' }); ok(r.s === 400, 'LPS belum terbit tidak bisa dikirim');
r = await us(`/lps/${d.id}/wa`, { method: 'POST' });
ok(d.branchName === 'Supriyadi' ? r.s === 201 : r.s === 404, `ustadzah: kirim LPS cabangnya saja (${d.branchName} → ${r.s})`);
r = await pj('/audit?entity=lps'); ok(r.s !== 200 || !JSON.stringify(r.j).includes(lpsTok2), 'token link tidak tertulis di audit');
r = await us('/lps'); ok(r.s === 200 && r.j.rows.every((x: any) => x.branchName === 'Supriyadi'), 'ustadzah melihat LPS cabangnya saja');
r = await us('/lps/generate', { method: 'POST', body: JSON.stringify({ period: '2026-10' }) }); ok(r.s === 403, 'ustadzah tidak bisa membuat LPS (hanya baca)');
r = await pj('/lps'); ok(r.j.aspects.length === 4 && r.j.branches.length === 4, 'ringkasan grafik: 4 aspek, 4 cabang');

console.log('Role & akun wali (portal)');
r = await pj('/roles'); ok(r.s === 200 && !r.j.roles.some((x: any) => x.code === 'ADMIN') && r.j.roles.some((x: any) => x.code === 'WALI'), 'Admin Sistem digabung ke PJ; role Wali Santri tersedia');
const wfam = (await pj(`/students/${d.studentId}`)).j.familyId;
const wacc = { name: 'Wali Uji', email: 'wali.uji@rta.local', password: SEED_PW, roleCode: 'WALI' };
r = await pj('/users', { method: 'POST', body: JSON.stringify(wacc) }); ok(r.s === 400, 'akun wali tanpa keluarga ditolak');
r = await us('/users', { method: 'POST', body: JSON.stringify({ ...wacc, familyId: wfam }) }); ok(r.s === 403, 'ustadzah tidak bisa membuat akun');
r = await pj('/users', { method: 'POST', body: JSON.stringify({ ...wacc, familyId: wfam }) }); ok(r.s === 201, 'PJ membuat akun wali terhubung ke keluarga');
const waliId = r.j.id;
r = await pj(`/users/${waliId}`, { method: 'PATCH', body: JSON.stringify({ roleCode: 'PJ' }) }); ok(r.s === 400, 'role wali tidak bisa ditukar ke role staf');
const wl = api(await login2(wacc.email));
r = await wl('/auth/me'); ok(r.s === 200 && r.j.role === 'WALI' && r.j.perms.every((p: string) => p.startsWith('portal.')) && Array.isArray(r.j.branchIds) && !r.j.branchIds.length, 'wali hanya punya izin portal, tanpa scope cabang');
r = await wl('/portal'); const pt = r.j;
ok(r.s === 200 && pt.kids.length > 0 && pt.lps.some((x: any) => x.id === d.id) && Array.isArray(pt.tagihan.bills), `portal wali: ${pt.kids.length} anak, ${pt.lps.length} LPS terbit, total tagihan ${pt.tagihan?.total}`);
ok(!/waPhone|address|healthNotes|subsidy|"Saudara"|Reguler|"note"/.test(JSON.stringify(pt)), 'portal wali tanpa kontak, alamat, kesehatan, maupun label subsidi');
r = await wl('/portal/perkembangan'); const pk = r.j;
ok(r.s === 200 && /^\d{4}\/\d{4}$/.test(pk.yearLabel) && pk.kids.length === pt.kids.length && pk.kids.every((k: any) => Array.isArray(k.weeks) && k.surahs.length > 0 && Array.isArray(k.lps)),
  `perkembangan wali: tahun ${pk.yearLabel}, ${pk.kids.length} anak, ${pk.kids.reduce((a: number, k: any) => a + k.weeks.length, 0)} pekan tercatat`);
ok(!/waPhone|address|healthNotes|subsidy|"note"|recordedBy/.test(JSON.stringify(pk)), 'perkembangan wali tanpa kontak, catatan, perekam, maupun label subsidi');
r = await us('/portal/perkembangan'); ok(r.s === 403, 'staf tidak bisa membuka endpoint perkembangan portal');
r = await wl(`/portal/lps/${d.id}/pdf`); ok(r.s === 200 && String(r.j).startsWith('%PDF'), 'wali mengunduh PDF LPS anaknya');
const draftLain = (await pj('/lps')).j.rows.find((x: any) => x.id && x.status !== 'TERBIT');
r = await wl(`/portal/lps/${draftLain.id}/pdf`); ok(r.s === 404, 'LPS belum terbit / keluarga lain ditolak (404)');
r = await wl(`/lps/${d.id}/pdf`); ok(r.s === 403, 'wali tidak bisa memakai endpoint LPS staf');
r = await wl('/students'); ok(r.s === 403, 'wali tidak bisa membuka data santri');
fd = new FormData(); fd.append('file', new Blob([png]), 'bukti.png');
r = await wl('/portal/bukti', { method: 'POST', body: fd });
if (pt.tagihan.total > 0) {
  ok(r.s === 201 && r.j.total === pt.tagihan.total, 'wali unggah bukti dari portal → menunggu verifikasi');
  r = await pj('/bayar/payments?state=MENUNGGU'); ok(r.j.some((p: any) => p.familyId === wfam && p.source === 'WEB' && p.recordedBy == null), 'bukti dari portal masuk antrean verifikasi PJ');
} else { ok(r.s === 400, 'tidak ada tagihan → unggah bukti ditolak'); ok(true, '(lewati: antrean verifikasi)'); }
r = await pj(`/users/${waliId}`, { method: 'PATCH', body: JSON.stringify({ isActive: false }) }); r = await wl('/portal'); ok(r.s === 404, 'akun wali dinonaktifkan → portal tertutup');

console.log('Akun ustadzah + cabang');
const gnk = (await pj('/branches')).j.find((b: any) => b.name === 'Genuk');
const uacc = { name: 'Ustadzah Uji Genuk', email: 'ustadzah.gnk.uji@rta.local', password: TEST_PW, roleCode: 'USTADZAH' }; // TEST_PW: login2 cukup sekali (hemat kuota login)
r = await pj('/users', { method: 'POST', body: JSON.stringify(uacc) }); ok(r.s === 400, 'akun ustadzah tanpa cabang ditolak');
r = await pj('/users', { method: 'POST', body: JSON.stringify({ ...uacc, branchIds: [gnk.id] }) }); ok(r.s === 201, 'PJ membuat akun ustadzah langsung dengan cabang Genuk');
r = await pj('/users?role=USTADZAH'); ok(r.j.find((x: any) => x.email === uacc.email)?.branches.some((b: any) => b.branchId === gnk.id), 'penugasan cabang tersimpan');
const ugs = await login2(uacc.email); const ug = api(ugs);
r = await ug('/students?size=100'); const gnkAll = (await pj(`/students?branchId=${gnk.id}&size=100`)).j.total;
ok(r.s === 200 && r.j.total === gnkAll && gnkAll > 0 && r.j.rows.every((x: any) => x.branchName === 'Genuk'), `ustadzah Genuk melihat semua santri Genuk dari data yang sama dengan PJ (${r.j.total})`);
r = await pj(`/students?branchId=${gnk.id}&status=AKTIF`); const cnt = r.j.counts;
ok(cnt[''] === gnkAll && cnt.AKTIF === r.j.total && cnt.AKTIF + cnt.CUTI + cnt.INDENT + cnt.KELUAR === cnt[''], `jumlah per tab status sesuai filter cabang, tidak terpengaruh filter status ${JSON.stringify(cnt)}`);

console.log('Hapus akun (daftar hapus 30 hari)');
const ugId = (await ug('/auth/me')).j.id; const pjId = (await pj('/auth/me')).j.id;
r = await us(`/users/${ugId}/hapus`, { method: 'POST', body: JSON.stringify({ reason: 'uji' }) }); ok(r.s === 403, 'ustadzah tidak bisa menghapus akun');
r = await mn(`/users/${ugId}/hapus`, { method: 'POST', body: JSON.stringify({ reason: 'uji' }) }); ok(r.s === 403, 'manajer tidak bisa menghapus akun');
r = await pj(`/users/${ugId}/hapus`, { method: 'POST', body: JSON.stringify({}) }); ok(r.s === 400, 'hapus tanpa alasan ditolak');
r = await pj(`/users/${pjId}/hapus`, { method: 'POST', body: JSON.stringify({ reason: 'uji hapus diri' }) }); ok(r.s === 400, 'PJ tidak bisa menghapus akun sendiri');
r = await pj(`/users/${ugId}/hapus`, { method: 'POST', body: JSON.stringify({ reason: 'Sudah tidak mengajar' }) });
const in30 = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
ok(r.s === 201 && Math.abs(new Date(r.j.deleteAfter).getTime() - new Date(in30).getTime()) <= 86400_000, `PJ memasukkan akun ke daftar hapus (dihapus permanen ${r.j.deleteAfter})`);
r = await pj(`/users/${ugId}/hapus`, { method: 'POST', body: JSON.stringify({ reason: 'lagi' }) }); ok(r.s === 400, 'akun yang sudah di daftar hapus tidak bisa dihapus lagi');
r = await pj('/users?role=USTADZAH'); let ugRow = r.j.find((x: any) => x.id === ugId); ok(!!ugRow?.deleteAfter && !ugRow.isActive && ugRow.deleteReason === 'Sudah tidak mengajar', 'daftar akun menampilkan tanggal hapus, alasan, dan status nonaktif');
r = await pj(`/users/${ugId}`, { method: 'PATCH', body: JSON.stringify({ isActive: true }) }); ok(r.s === 400, 'akun di daftar hapus tidak bisa diaktifkan tanpa membatalkan penghapusan');
r = await pj(`/users/${ugId}/reset-password`, { method: 'POST' }); ok(r.s === 400, 'akun di daftar hapus tidak bisa direset password');
let rf = await fetch(B + '/auth/refresh', { method: 'POST', headers: { cookie: ugs.cookie ?? '' } }); ok(rf.status === 401, 'sesi akun di daftar hapus dicabut (refresh ditolak)');
r = await pj(`/users/${ugId}/batal-hapus`, { method: 'POST' }); ok(r.s === 201, 'PJ membatalkan penghapusan');
r = await pj('/users?role=USTADZAH'); ugRow = r.j.find((x: any) => x.id === ugId); ok(ugRow && !ugRow.deleteAfter && ugRow.isActive, 'akun aktif kembali setelah dibatalkan');
r = await pj(`/users/${ugId}/batal-hapus`, { method: 'POST' }); ok(r.s === 404, 'batal hapus untuk akun yang tidak di daftar hapus → 404');

console.log('Data santri (kolom spreadsheet)');
const SUB = Object.fromEntries((await pj('/subsidies')).j.map((x: any) => [x.name, x]));
const ngb = (await pj('/branches')).j.find((b: any) => b.name === 'Ngaliyan'); const ngc30 = (await pj('/classes')).j.find((c: any) => c.branchId === ngb.id && c.level === 'JUZ30');
const baru = { fullName: 'Uji Kolom Santri', gender: 'P', birthPlace: 'Semarang', birthDate: '2018-05-06', branchId: ngb.id, classId: ngc30.id, joinDate: '2026-07-01', status: 'INDENT',
  registrationNote: 'Daftar lewat WhatsApp', subsidyId: SUB['Kurang mampu'].id,
  family: { fatherName: 'Ayah Uji', motherName: 'Ibu Uji', waPhone: '081299990001', address: 'Jl. Uji No. 1, Semarang', fatherJob: 'Guru', motherJob: 'Perawat' } };
const spyb = (await pj('/branches')).j.find((b: any) => b.name === 'Supriyadi'); const spyc = (await pj('/classes')).j.find((c: any) => c.branchId === spyb.id && c.level === 'JUZ30');
r = await us('/students', { method: 'POST', body: JSON.stringify({ ...baru, fullName: 'Uji Subsidi Ustadzah', branchId: spyb.id, classId: spyc.id, family: { ...baru.family, waPhone: '081299990002' } }) });
ok(r.s === 400, 'ustadzah tidak bisa mengisi kategori subsidi saat tambah santri');
const ngLast = Math.max(0, ...(await pj(`/students?branchId=${ngb.id}&size=100`)).j.rows.map((x: any) => Number(x.nis.match(/^RTA-NGL-(\d+)$/)?.[1] ?? 0)));
r = await pj('/students', { method: 'POST', body: JSON.stringify(baru) }); ok(r.s === 201 && r.j.nis === `RTA-NGL-${String(ngLast + 1).padStart(3, '0')}`, `PJ menambah santri dengan keterangan pendaftaran & kategori subsidi (ID ${r.j.nis} = RTA-kode cabang-urut)`);
const nid = r.j.id;
r = await pj('/students', { method: 'POST', body: JSON.stringify({ ...baru, fullName: 'Uji Urut Kedua', family: { ...baru.family, waPhone: '081299990006' } }) }); ok(r.s === 201 && r.j.nis === `RTA-NGL-${String(ngLast + 2).padStart(3, '0')}`, `ID berikutnya di cabang yang sama naik satu (${r.j.nis})`);
r = await pj('/students?q=Uji Kolom'); const lr = r.j.rows[0];
ok(lr && lr.registrationNote === 'Daftar lewat WhatsApp' && lr.subsidyLabel === 'Kurang mampu' && lr.motherName === 'Ibu Uji' && lr.waPhone === '081299990001' && lr.address && lr.fatherJob === 'Guru' && lr.motherJob === 'Perawat' && lr.level === 'JUZ30' && lr.birthPlace === 'Semarang',
  'daftar santri memuat semua kolom spreadsheet (PJ)');
r = await mn('/students?q=Uji Kolom'); const lm = r.j.rows[0];
ok(lm && lm.waPhone === 'Disembunyikan' && lm.address === 'Disembunyikan' && lm.motherJob === 'Disembunyikan' && !('subsidyLabel' in lm) && lm.registrationNote === 'Daftar lewat WhatsApp', 'daftar santri manajer: kontak/alamat/pekerjaan dimasking, kategori subsidi tidak dikirim');
r = await mn(`/students/${nid}`); ok(r.s === 200 && !('subsidyLabel' in r.j) && !('subsidyId' in r.j), 'detail santri manajer: kategori subsidi tidak dikirim');
r = await pj(`/students/${nid}`); ok(r.j.sppRate === 105000 && r.j.subsidyId === SUB['Kurang mampu'].id, `tarif santri baru mengikuti kategori subsidi (${r.j.sppRate})`);
r = await pj(`/students/${nid}`, { method: 'PATCH', body: JSON.stringify({ registrationNote: 'Pindahan dari TPQ lain' }) }); ok(r.s === 200 && (await pj(`/students/${nid}`)).j.registrationNote === 'Pindahan dari TPQ lain', 'keterangan pendaftaran bisa diubah');
r = await pj('/import/students/template'); ok(r.s === 200 && String(r.j).startsWith('ID Santri,Nama Lengkap,Jenis Kelamin'), 'template impor = kolom spreadsheet');
fd = new FormData(); fd.append('file', new Blob(['ID Santri,Nama Lengkap,Jenis Kelamin,Tempat Lahir,Tanggal Lahir,Cabang,Jenjang,Tanggal Bergabung,Status,Keterangan Pendaftaran,Kategori Subsidi,Nama Ayah,Nama Ibu,No WA Wali,Alamat,Pekerjaan Ayah,Pekerjaan Ibu\n' +
  'RTA-NGL-901,Uji Impor,Perempuan,Semarang,04/03/2017,Ngaliyan,Juz 30,01/07/2026,Indent,Daftar lewat WhatsApp,,Ayah Impor,Ibu Impor,081299990003,"Jl. Impor 1, Semarang",Guru,Perawat\n'], { type: 'text/csv' }), 't.csv');
r = await pj('/import/students?dryRun=true', { method: 'POST', body: fd }); ok(r.s === 201 && r.j.ok === true, 'impor (cek) dengan header spreadsheet & tanggal DD/MM/YYYY: ' + JSON.stringify(r.j.errors ?? []));
r = await pj('/import/students/template?format=xlsx'); ok(r.s === 200 && String(r.j).startsWith('PK'), 'template impor tersedia dalam format Excel (.xlsx)');
{ // file xlsx dari Excel: tanggal sebagai sel tanggal, no. WA tersimpan sebagai angka (0 di depan hilang)
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Data');
  ws.addRow(['ID Santri', 'Nama Lengkap', 'Jenis Kelamin', 'Tempat Lahir', 'Tanggal Lahir', 'Cabang', 'Jenjang', 'Tanggal Bergabung', 'Status', 'Keterangan Pendaftaran', 'Kategori Subsidi', 'Nama Ayah', 'Nama Ibu', 'No WA Wali', 'Alamat', 'Pekerjaan Ayah', 'Pekerjaan Ibu']);
  ws.addRow(['RTA-NGL-902', 'Uji Impor Excel', 'Laki-laki', 'Semarang', new Date(Date.UTC(2017, 2, 4)), 'Ngaliyan', 'Juz 30', new Date(Date.UTC(2026, 6, 1)), 'Indent', 'Data lama', null, 'Ayah Excel', 'Ibu Excel', 81299990004, 'Jl. Excel 1, Semarang', 'Guru', 'Perawat']);
  ws.addRow([]); // baris kosong dilewati
  ws.addRow(['RTA-NGL-903', 'Uji Impor Excel 2', 'P', 'Semarang', '2017-05-06', 'Ngaliyan', 'JUZ30', '01/07/2026', 'AKTIF', 'Data lama', null, 'Ayah Excel', 'Ibu Excel', '081299990005', 'Jl. Excel 2, Semarang']);
  fd = new FormData(); fd.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'santri.xlsx');
  r = await pj('/import/students?dryRun=true', { method: 'POST', body: fd }); ok(r.s === 201 && r.j.ok === true && r.j.total === 2, 'impor (cek) file .xlsx: sel tanggal & no. WA angka dikenali, baris kosong dilewati ' + JSON.stringify(r.j.errors ?? []));
  ws.getRow(4).getCell(3).value = 'X'; fd = new FormData(); fd.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'santri.xlsx');
  r = await pj('/import/students?dryRun=true', { method: 'POST', body: fd }); ok(r.s === 201 && r.j.ok === false && r.j.errors.some((e: any) => e.row === 4), 'error xlsx menunjuk nomor baris asli di Excel');
  fd = new FormData(); fd.append('file', new Blob([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])]), 'lama.xls');
  r = await pj('/import/students?dryRun=true', { method: 'POST', body: fd }); ok(r.s === 400, 'file .xls lama ditolak dengan pesan jelas');
}
{ // data lama: santri berstatus CUTI / KELUAR bisa diimpor
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Data');
  ws.addRow(['ID Santri', 'Nama Lengkap', 'Jenis Kelamin', 'Tempat Lahir', 'Tanggal Lahir', 'Cabang', 'Jenjang', 'Tanggal Bergabung', 'Status', 'Keterangan Pendaftaran', 'Kategori Subsidi', 'Nama Ayah', 'Nama Ibu', 'No WA Wali', 'Alamat']);
  ws.addRow(['RTA-SPY-901', 'Uji Impor Cuti', 'P', 'Semarang', '2017-05-06', 'Supriyadi', 'JUZ30', '2025-07-01', 'Cuti', 'Data lama', null, 'Ayah Lama', 'Ibu Lama', '081299990007', 'Jl. Lama 1, Semarang']);
  ws.addRow(['RTA-SPY-902', 'Uji Impor Keluar', 'P', 'Semarang', '2017-06-07', 'Supriyadi', 'JUZ30', '2025-07-01', 'KELUAR', 'Data lama', null, 'Ayah Lama', 'Ibu Lama', '081299990008', 'Jl. Lama 2, Semarang']);
  fd = new FormData(); fd.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'lama.xlsx');
  r = await pj('/import/students', { method: 'POST', body: fd }); ok(r.s === 201 && r.j.ok === true && r.j.total === 2, 'impor .xlsx santri berstatus CUTI & KELUAR ' + JSON.stringify(r.j.errors ?? r.j));
  const st = async (q: string) => (await pj(`/students?q=${q}`)).j.rows[0]?.status;
  ok((await st('Uji Impor Cuti')) === 'CUTI' && (await st('Uji Impor Keluar')) === 'KELUAR', 'status CUTI & KELUAR tersimpan sesuai file');
}
{ // hanya ID, nama, JK, cabang, jenjang, tgl bergabung, status, keterangan yang wajib; ID Santri dari file = ID resmi
  const head = 'ID Santri,Nama Lengkap,Jenis Kelamin,Tempat Lahir,Tanggal Lahir,Cabang,Jenjang,Tanggal Bergabung,Status,Keterangan Pendaftaran,Kategori Subsidi,Nama Ayah,Nama Ibu,No WA Wali,Alamat\n';
  const up = (lines: string[]) => { const f = new FormData(); f.append('file', new Blob([head + lines.join('\n') + '\n'], { type: 'text/csv' }), 'm.csv'); return f; };
  r = await pj('/import/students?dryRun=true', { method: 'POST', body: up([
    ',Uji Tanpa ID,P,,,Ngaliyan,Juz 30,01/07/2025,Aktif,Data lama,,,,,',
    'RTA-NGL-950,Uji Tanpa Keterangan,P,,,Ngaliyan,Juz 30,01/07/2025,,,,,,,',
    'NGL-1,Uji Format ID,P,,,Ngaliyan,Juz 30,01/07/2025,Aktif,Data lama,,,,,',
    'RTA-XYZ-001,Uji Kode Asing,P,,,Ngaliyan,Juz 30,01/07/2025,Aktif,Data lama,,,,,',
    'RTA-NGL-951,Uji ID Ganda A,P,,,Ngaliyan,Juz 30,01/07/2025,Aktif,Data lama,,,,,',
    'rta-ngl-951,Uji ID Ganda B,P,,,Ngaliyan,Juz 30,01/07/2025,Aktif,Data lama,,,,,',
    'RTA-NGL-952,Uji WA Salah,P,,,Ngaliyan,Juz 30,01/07/2025,Aktif,Data lama,,,,12345,',
  ]) });
  const msg = (row: number) => (r.j.errors ?? []).filter((e: any) => e.row === row).map((e: any) => e.message).join(' | ');
  ok(r.s === 201 && r.j.ok === false && /ID Santri kosong/.test(msg(2)) && /Status kosong/.test(msg(3)) && /Keterangan Pendaftaran kosong/.test(msg(3)) && /berformat/.test(msg(4))
    && /tidak dikenal/.test(msg(5)) && msg(6) === '' && /sama dengan baris 6/.test(msg(7)) && /No WA Wali tidak valid/.test(msg(8)),
    'impor: kolom wajib kosong, format ID salah, kode cabang asing, ID ganda di file, dan no. WA salah ditolak per baris ' + JSON.stringify(r.j.errors));
  r = await pj('/import/students', { method: 'POST', body: up([
    'RTA-NGL-960,Uji Minimal Satu,P,,,Ngaliyan,Juz 30,01/07/2025,Aktif,Data lama,,,,,',
    'RTA-NGL-961,Uji Minimal Dua,L,Semarang,,Ngaliyan,Juz 30,01/07/2025,Aktif,Data lama,,Ayah Minimal,,,',
  ]) });
  ok(r.s === 201 && r.j.ok === true && r.j.nis?.join() === 'RTA-NGL-960,RTA-NGL-961', 'impor hanya kolom wajib tersimpan, ID Santri sesuai file ' + JSON.stringify(r.j.errors ?? r.j));
  const getS = async (q: string) => (await pj(`/students/${(await pj(`/students?q=${encodeURIComponent(q)}`)).j.rows[0]?.id}`)).j;
  const m1 = await getS('Uji Minimal Satu'), m2 = await getS('Uji Minimal Dua');
  ok(m1.nis === 'RTA-NGL-960' && m1.birthDate === null && m1.birthPlace === null && m1.age === null && m1.family.waPhone === null && m1.family.fatherName === null && m1.family.address === null
    && m2.birthPlace === 'Semarang' && m2.family.fatherName === 'Ayah Minimal' && m1.familyId !== m2.familyId, 'kolom opsional kosong tersimpan NULL; tanpa no. WA tiap santri jadi keluarga sendiri');
  r = await pj('/import/students?dryRun=true', { method: 'POST', body: up(['RTA-NGL-962,Uji Minimal Satu,P,,,Ngaliyan,Juz 30,01/07/2025,Aktif,Data lama,,,,,']) });
  ok(r.j.ok === false && /nama yang sama sudah terdaftar di cabang ini/.test(r.j.errors[0]?.message), 'tanpa tanggal lahir: santri ganda dicocokkan dengan nama + cabang');
  r = await pj('/import/students?dryRun=true', { method: 'POST', body: up(['RTA-NGL-960,Uji ID Terpakai,P,,,Ngaliyan,Juz 30,01/07/2025,Aktif,Data lama,,,,,']) });
  ok(r.j.ok === false && /sudah dipakai/.test(r.j.errors[0]?.message), 'ID Santri yang sudah ada di database ditolak');
  r = await pj('/students', { method: 'POST', body: JSON.stringify({ ...baru, fullName: 'Uji Lanjut ID', subsidyId: undefined, family: { ...baru.family, waPhone: '081299990010' } }) });
  ok(r.s === 201 && r.j.nis === 'RTA-NGL-962', `ID otomatis berikutnya melanjutkan nomor terbesar hasil impor (${r.j.nis})`);
  r = await pj(`/bayar/families/${m1.familyId}/link`, { method: 'POST' });
  ok(r.s === 400 && /No\. WA wali belum diisi/.test(r.j.message), 'kirim tagihan ke keluarga tanpa no. WA ditolak dengan pesan jelas');
  r = await pj('/bayar/families'); const fm = r.j.find((x: any) => x.id === m1.familyId);
  ok(fm?.fatherName === '(nama wali belum diisi)', 'label keluarga tanpa nama orang tua tidak kosong/null di menu Bayar');
}

console.log('Pengajuan mutasi');
const srow = (await us('/students?status=AKTIF')).j.rows.find((x: any) => x.status === 'AKTIF'); const sid = srow.id;
const ng = (await pj('/branches')).j.find((b: any) => b.name === 'Ngaliyan'); const ngc = (await pj('/classes')).j.find((c: any) => c.branchId === ng.id && c.level === 'JUZ30');
r = await us(`/students/${sid}/requests`, { method: 'POST', body: JSON.stringify({ type: 'MUTASI', targetBranchId: ng.id, targetClassId: ngc.id, effectiveDate: '2026-11-01', reason: 'Pindah domisili' }) }); ok(r.s === 201, 'ustadzah mengajukan mutasi ' + JSON.stringify(r.j));
const reqId = r.j.id;
r = await pj(`/requests/${reqId}`); ok(r.s === 200 && r.j.to.branch === 'Ngaliyan' && r.j.to.spp === 200000, `detail tinjau: ${r.j.from.branch} → ${r.j.to.branch}, SPP ${r.j.from.spp} → ${r.j.to.spp}, tunggakan ${r.j.checks.tunggakan}`);
r = await us(`/requests/${reqId}/withdraw`, { method: 'POST' }); ok(r.s === 201, 'ustadzah menarik pengajuan');
r = await us(`/students/${sid}/requests`, { method: 'POST', body: JSON.stringify({ type: 'MUTASI', targetBranchId: ng.id, targetClassId: ngc.id, effectiveDate: '2026-11-01', reason: 'Pindah domisili' }) });
r = await pj(`/requests/${r.j.id}/approve`, { method: 'POST', body: JSON.stringify({}) }); ok(r.s === 201, 'PJ menyetujui mutasi');
r = await pj(`/spp/students?q=`); const moved = r.j.rows.find((x: any) => x.id === sid); ok(moved && moved.sisa >= 100000, `biaya pindah tercatat (sisa ${moved?.sisa})`);
r = await us(`/students/${sid}`); ok(r.s === 404, 'setelah mutasi, ustadzah asal tidak lagi melihat santri');
r = await pj(`/students/${sid}`); ok(r.j.nis === srow.nis && srow.nis.startsWith('RTA-SPY-'), `ID santri tidak berubah setelah mutasi (${r.j.nis})`);

console.log('Pengaturan');
r = await us('/settings'); ok(r.s === 200 && r.j.branches.length === 1 && r.j.banks.length === 1 && r.j.banks[0].branchName === 'Supriyadi', 'ustadzah membuka Pengaturan: hanya cabangnya (tarif & rekening)');
r = await us('/settings', { method: 'PATCH', body: JSON.stringify({ linkDays: 7 }) }); ok(r.s === 403, 'ustadzah tidak bisa mengubah nilai Pengaturan selain rekening');
r = await mn('/settings'); ok(r.s === 200 && r.j.values.reregistrationFee === 100000 && r.j.branches.length === 4 && r.j.banks.length === 4 && !('bankAccount' in r.j.values), 'manajer melihat Pengaturan (nilai bawaan, 4 cabang, rekening per cabang)');
{
  const banks = (await pj('/settings')).j.banks; const gnk = banks.find((b: any) => b.branchName === 'Genuk'), spy = banks.find((b: any) => b.branchName === 'Supriyadi');
  const body = (acc: string) => JSON.stringify({ bankName: 'Bank Uji', bankAccount: acc, bankHolder: 'Yayasan Al-Fatihah' });
  r = await us(`/settings/branches/${gnk.branchId}/bank`, { method: 'PATCH', body: body('111 222 333') }); ok(r.s === 404, 'ustadzah Supriyadi tidak bisa mengubah rekening cabang Genuk (404)');
  r = await mn(`/settings/branches/${spy.branchId}/bank`, { method: 'PATCH', body: body('111 222 333') }); ok(r.s === 403, 'manajer tidak bisa mengubah rekening');
  r = await us(`/settings/branches/${spy.branchId}/bank`, { method: 'PATCH', body: body('12ab') }); ok(r.s === 400, 'nomor rekening berhuruf ditolak');
  r = await us(`/settings/branches/${spy.branchId}/bank`, { method: 'PATCH', body: body('1234 5678 90') }); ok(r.s === 200 && r.j.changed, 'ustadzah mengubah rekening cabangnya sendiri');
  r = await pj(`/settings/branches/${gnk.branchId}/bank`, { method: 'PATCH', body: body('9999 0000 11') }); ok(r.s === 200, 'PJ mengubah rekening cabang lain (Genuk)');
  const after = (await pj('/settings')).j.banks;
  ok(after.find((b: any) => b.branchName === 'Supriyadi').account === '1234 5678 90' && after.find((b: any) => b.branchName === 'Genuk').account === '9999 0000 11' && after.find((b: any) => b.branchName === 'Ngaliyan').isDefault, 'rekening tiap cabang terpisah; cabang lain tetap rekening bawaan');
  r = await pj(`/audit?entity=branch&entityId=${spy.branchId}`); ok(r.j.some((a: any) => a.action === 'ubah_rekening' && a.newValue?.bankAccount === '1234 5678 90'), 'perubahan rekening tercatat di audit');
}
r = await mn('/settings', { method: 'PATCH', body: JSON.stringify({ linkDays: 7 }) }); ok(r.s === 403, 'manajer tidak bisa mengubah Pengaturan');
r = await pj('/settings', { method: 'PATCH', body: JSON.stringify({ waTemplate: 'Tagihan {tagihan} {total}' }) }); ok(r.s === 400, 'template WA tanpa {link} ditolak');
r = await pj('/settings', { method: 'PATCH', body: JSON.stringify({ waTemplate: '1\n2\n3\n4\n5\n{link}' }) }); ok(r.s === 400, 'template WA lebih dari 5 baris ditolak');
r = await pj('/settings', { method: 'PATCH', body: JSON.stringify({ waTemplate: 'Kategori {subsidi}: {link}' }) }); ok(r.s === 400, 'placeholder tidak dikenal ditolak: ' + r.j.message);
r = await pj('/settings', { method: 'PATCH', body: JSON.stringify({ linkDays: 120 }) }); ok(r.s === 400, 'masa berlaku link > 90 hari ditolak');
r = await pj('/settings', { method: 'PATCH', body: JSON.stringify({ waTemplate: "Assalamu'alaikum 🌿\nTagihan {tagihan} untuk {nama}: {total}\nUji template: {link}", linkDays: 7 }) });
ok(r.s === 200 && r.j.changed === 2, 'PJ mengubah template WA dan masa berlaku link');
{
  const f = (await us('/bayar/families')).j.find((x: any) => x.total > 0);
  r = await us(`/bayar/families/${f.id}/link`, { method: 'POST' }); ok(r.s === 201 && r.j.message.includes('Uji template: ' + r.j.url) && r.j.message.includes('Rp'), 'pesan WA mengikuti template baru');
  const pb = await fetch(B + '/public/tagihan/' + r.j.url.split('/bayar/')[1]).then((x) => x.json() as any); ok(pb.banks.some((b: any) => b.account === '1234 5678 90' && b.branches.includes('Supriyadi')) && pb.banks.every((b: any) => b.account !== '9999 0000 11'), 'halaman wali memakai rekening cabang santrinya (Supriyadi)');
}
r = await pj('/audit?entity=settings'); ok(r.s === 200 && r.j.some((a: any) => a.newValue?.linkDays === 7 && a.oldValue?.linkDays === 30), 'perubahan Pengaturan tercatat di audit (nilai lama & baru)');
{
  const gnk = (await pj('/settings')).j.branches.find((b: any) => b.code === 'GNK');
  r = await mn(`/settings/branches/${gnk.id}`, { method: 'PATCH', body: JSON.stringify({ sppStandard: 160000, registrationFee: gnk.registrationFee }) }); ok(r.s === 403, 'manajer tidak bisa mengubah tarif cabang');
  r = await pj(`/settings/branches/${gnk.id}`, { method: 'PATCH', body: JSON.stringify({ sppStandard: -1, registrationFee: gnk.registrationFee }) }); ok(r.s === 400, 'tarif negatif ditolak');
  r = await pj(`/settings/branches/${gnk.id}`, { method: 'PATCH', body: JSON.stringify({ sppStandard: gnk.sppStandard + 10000, registrationFee: gnk.registrationFee, applyToStudents: true }) });
  ok(r.s === 200 && r.j.santriDiubah === gnk.santriTarifStandar, `tarif Genuk naik, ${r.j.santriDiubah} santri bertarif standar ikut diperbarui`);
  r = await pj('/branches'); ok(r.j.find((b: any) => b.id === gnk.id).sppStandard === gnk.sppStandard + 10000, 'tarif baru terbaca di daftar cabang');
}
await pj('/spp/generate-reregistration', { method: 'POST' });
r = await pj('/spp/generate-reregistration', { method: 'POST' }); ok(r.s === 201 && r.j.created === 0, 'daftar ulang tidak ditagih dua kali');
await pj('/settings', { method: 'PATCH', body: JSON.stringify({ academicYearStartMonth: 6 }) });
r = await pj('/spp/generate-reregistration', { method: 'POST' }); ok(r.s === 201 && r.j.created === 0, 'bulan mulai tahun ajaran digeser → tetap tidak ditagih ulang');
await pj('/settings', { method: 'PATCH', body: JSON.stringify({ academicYearStartMonth: 7 }) });

console.log('Subsidi');
r = await us('/subsidies'); ok(r.s === 403, 'ustadzah tidak bisa membuka master subsidi');
r = await mn('/subsidies'); ok(r.s === 403, 'manajer tidak bisa melihat master subsidi (label rahasia)');
{
  const subs = (await pj('/subsidies')).j; const B = Object.fromEntries((await pj('/branches')).j.map((b: any) => [b.code, b]));
  const S = Object.fromEntries(subs.map((x: any) => [x.name, x])); const amt = (x: any, code: string) => x.rates.find((r: any) => r.branchId === B[code].id && r.available)?.amount;
  ok(subs.length === 4 && amt(S['Saudara'], 'NGL') === 100000 && amt(S['Yatim'], 'GNK') === 5000 && !amt(S['Daycare yayasan'], 'GNK') && amt(S['Daycare yayasan'], 'SPY') === 125000,
    'master subsidi sesuai prd.md 8.2 (saudara Ngaliyan Rp100.000, daycare hanya Supriyadi)');
  const all = (await pj('/students?status=AKTIF&size=100')).j.rows;
  const gnk = all.find((x: any) => x.branchId === B.GNK.id);
  r = await pj(`/students/${gnk.id}`, { method: 'PATCH', body: JSON.stringify({ subsidyId: S['Daycare yayasan'].id }) }); ok(r.s === 400, 'subsidi yang tidak berlaku di cabang ditolak: ' + r.j.message);
  // yatim di Supriyadi → tarif pengganti; master diubah + terapkan ke santri
  const spy = all.find((x: any) => x.branchId === B.SPY.id && !x.subsidyLabel);
  r = await pj(`/students/${spy.id}`, { method: 'PATCH', body: JSON.stringify({ subsidyId: S['Yatim'].id }) });
  let st = (await pj(`/students/${spy.id}`)).j; ok(r.s === 200 && st.sppRate === 5000 && st.subsidyLabel === 'Yatim' && st.subsidySince, `pasang subsidi Yatim → tarif ${st.sppRate}`);
  r = await pj(`/students/${spy.id}`, { method: 'PATCH', body: JSON.stringify({ sppRate: 1000 }) }); ok(r.s === 400, 'tarif santri bersubsidi tidak bisa diubah manual');
  const yr = (code: string, amount?: number, available = true) => ({ branchId: B[code].id, available, amount });
  const yatim = { name: 'Yatim', kind: 'TARIF', isSibling: false, rates: [yr('GNK', 5000), yr('SPY', 6000), yr('PDR', 5000), { ...yr('NGL', 5000), note: 'Hanya santri pindahan' }] };
  r = await mn(`/subsidies/${S['Yatim'].id}`, { method: 'PATCH', body: JSON.stringify(yatim) }); ok(r.s === 403, 'manajer tidak bisa mengubah tarif subsidi');
  r = await pj(`/subsidies/${S['Yatim'].id}`, { method: 'PATCH', body: JSON.stringify({ ...yatim, rates: [yr('GNK', 5000), yr('SPY', 6000, false), yr('PDR', 5000), yr('NGL', 5000)] }) });
  ok(r.s === 400, 'cabang tidak bisa dicabut selama masih dipakai santri: ' + r.j.message);
  r = await pj(`/subsidies/${S['Yatim'].id}`, { method: 'PATCH', body: JSON.stringify({ ...yatim, applyToStudents: true }) });
  ok(r.s === 200 && r.j.santriDiubah >= 1 && (await pj(`/students/${spy.id}`)).j.sppRate === 6000, `tarif Yatim Supriyadi Rp6.000, diterapkan ke ${r.j.santriDiubah} santri`);
  r = await pj('/audit?entity=subsidy'); ok(r.j.some((a: any) => a.newValue?.santriDiubah >= 1), 'perubahan tarif subsidi tercatat di audit');
  r = await pj(`/students/${spy.id}`, { method: 'PATCH', body: JSON.stringify({ subsidyId: null }) }); st = (await pj(`/students/${spy.id}`)).j;
  ok(r.s === 200 && st.subsidyId === null && st.subsidyLabel === null && st.sppRate === B.SPY.sppStandard, 'cabut subsidi → kembali ke tarif standar cabang');
  // mutasi: daycare tidak berlaku di Ngaliyan → dicabut, tarif cabang tujuan
  await pj(`/students/${spy.id}`, { method: 'PATCH', body: JSON.stringify({ subsidyId: S['Daycare yayasan'].id }) });
  const ngc2 = (await pj('/classes')).j.find((c: any) => c.branchId === B.NGL.id && c.level === 'JUZ30');
  r = await us(`/students/${spy.id}/requests`, { method: 'POST', body: JSON.stringify({ type: 'MUTASI', targetBranchId: B.NGL.id, targetClassId: ngc2.id, effectiveDate: '2026-11-05', reason: 'Pindah domisili' }) });
  await pj(`/requests/${r.j.id}/approve`, { method: 'POST', body: JSON.stringify({}) }); st = (await pj(`/students/${spy.id}`)).j;
  ok(st.subsidyId === null && st.sppRate === B.NGL.sppStandard, 'mutasi: subsidi daycare dicabut otomatis (tidak berlaku di cabang tujuan), tarif Ngaliyan');
  // diskon saudara: butuh saudara Aktif; dicabut otomatis bila salah satu cuti
  r = await pj(`/students/${nid}`, { method: 'PATCH', body: JSON.stringify({ subsidyId: S['Saudara'].id }) }); ok(r.s === 400, 'diskon saudara tanpa saudara Aktif ditolak');
  const byFam: Record<number, any[]> = {}; for (const x of all.filter((x: any) => x.id !== spy.id)) (byFam[x.familyId] ??= []).push(x);
  const [k1, k2] = Object.values(byFam).find((xs) => xs.length >= 2)!;
  for (const k of [k1, k2]) await pj(`/students/${k.id}`, { method: 'PATCH', body: JSON.stringify({ subsidyId: S['Saudara'].id }) });
  const half = (k: any) => Math.round(B[Object.keys(B).find((c) => B[c].id === k.branchId)!].sppStandard / 2);
  ok((await pj(`/students/${k1.id}`)).j.sppRate === half(k1) && (await pj(`/students/${k2.id}`)).j.sppRate === half(k2), 'dua saudara masing-masing 50% dari tarif cabangnya');
  r = await pj(`/students/${k1.id}/status`, { method: 'POST', body: JSON.stringify({ action: 'CUTI', effectiveDate: '2026-11-05', reason: 'Sakit' }) });
  const k2n = (await pj(`/students/${k2.id}`)).j;
  ok(r.s === 201 && r.j.subsidiDicabut === 2 && k2n.subsidyId === null && k2n.sppRate === half(k2) * 2, `salah satu saudara cuti → diskon saudara dicabut otomatis (${r.j.subsidiDicabut} santri), tarif kembali standar`);
  r = await pj(`/audit?entity=student&entityId=${k2.id}`); ok(r.j.some((a: any) => a.action === 'subsidi_dicabut_otomatis'), 'pencabutan otomatis tercatat di audit');
  await pj(`/students/${k1.id}/status`, { method: 'POST', body: JSON.stringify({ action: 'AKTIF', effectiveDate: '2026-11-05' }) });
  // santri baru berkategori Saudara di keluarga yang sudah ada → saudara Aktif yang masih Reguler ikut; yang bersubsidi lain tidak diubah
  {
    const mk = async (fullName: string, birthDate: string, extra: any) => pj('/students', { method: 'POST', body: JSON.stringify({ ...baru, fullName, birthDate, status: 'AKTIF', branchId: ngb.id, classId: ngc30.id, subsidyId: undefined, ...extra }) });
    const kakak = await mk('Uji Kakak Reguler', '2015-01-02', { family: { ...baru.family, waPhone: '081299990041' } });
    const famId = (await pj(`/students/${kakak.j.id}`)).j.familyId;
    r = await mk('Uji Adik Saudara Baru', '2019-03-04', { familyId: famId, family: undefined, subsidyId: S['Saudara'].id });
    const ka = (await pj(`/students/${kakak.j.id}`)).j, ad = (await pj(`/students/${r.j.id}`)).j, half = Math.round((await pj("/branches")).j.find((b: any) => b.id === ngb.id).sppStandard / 2);
    ok(r.s === 201 && r.j.saudaraIkut === 1 && ka.subsidyId === S['Saudara'].id && ka.sppRate === half && ad.sppRate === half,
      `daftar adik berkategori Saudara → kakak Reguler ikut Saudara (${ka.sppRate} & ${ad.sppRate})`);
    r = await pj(`/audit?entity=student&entityId=${kakak.j.id}`); ok(r.j.some((x: any) => x.action === 'subsidi_dipasang_otomatis'), 'pemasangan otomatis ke saudara tercatat di audit');
    const yatim = await mk('Uji Kakak Yatim', '2015-05-06', { family: { ...baru.family, waPhone: '081299990042' }, subsidyId: S['Yatim'].id });
    const famY = (await pj(`/students/${yatim.j.id}`)).j.familyId;
    r = await mk('Uji Adik Saudara Yatim', '2019-07-08', { familyId: famY, family: undefined, subsidyId: S['Saudara'].id });
    const ky = (await pj(`/students/${yatim.j.id}`)).j;
    ok(r.s === 201 && r.j.saudaraIkut === 0 && ky.subsidyId === S['Yatim'].id, 'saudara yang sudah bersubsidi lain (Yatim) tidak diubah');
  }
  // kategori baru, nama ganda, nonaktifkan
  const baruSub = { name: 'Uji Beasiswa', kind: 'TARIF', rates: [yr('GNK', 50000), yr('SPY', undefined, false), yr('PDR', undefined, false), yr('NGL', undefined, false)] };
  r = await pj('/subsidies', { method: 'POST', body: JSON.stringify({ ...baruSub, rates: [yr('GNK'), ...baruSub.rates.slice(1)] }) }); ok(r.s === 400, 'tarif pengganti kosong ditolak');
  r = await pj('/subsidies', { method: 'POST', body: JSON.stringify(baruSub) }); ok(r.s === 201, 'PJ menambah kategori subsidi baru');
  const bid = r.j.id;
  r = await pj('/subsidies', { method: 'POST', body: JSON.stringify({ ...baruSub, name: 'yatim' }) }); ok(r.s === 400, 'nama kategori ganda ditolak');
  r = await pj(`/subsidies/${bid}`, { method: 'PATCH', body: JSON.stringify({ ...baruSub, isActive: false }) }); ok(r.s === 200 && !(await pj('/subsidies')).j.find((x: any) => x.id === bid).isActive, 'kategori yang tidak dipakai bisa dinonaktifkan');
  fd = new FormData(); fd.append('file', new Blob(['ID Santri,Nama Lengkap,Jenis Kelamin,Tempat Lahir,Tanggal Lahir,Cabang,Jenjang,Tanggal Bergabung,Status,Keterangan Pendaftaran,Kategori Subsidi,Nama Ayah,Nama Ibu,No WA Wali,Alamat\n' +
    'RTA-GNK-901,Uji Impor Subsidi,P,Semarang,04/03/2017,Genuk,Juz 30,01/07/2026,Indent,Data lama,Daycare yayasan,Ayah,Ibu,081299990009,Jl. Uji\n'], { type: 'text/csv' }), 's.csv');
  r = await pj('/import/students?dryRun=true', { method: 'POST', body: fd }); ok(r.s === 201 && r.j.ok === false && /tidak berlaku di cabang Genuk/.test(r.j.errors[0]?.message), 'impor: subsidi yang tidak berlaku di cabang ditolak');
  fd = new FormData(); fd.append('file', new Blob(['ID Santri,Nama Lengkap,Jenis Kelamin,Tempat Lahir,Tanggal Lahir,Cabang,Jenjang,Tanggal Bergabung,Status,Keterangan Pendaftaran,Kategori Subsidi,Nama Ayah,Nama Ibu,No WA Wali,Alamat\n' +
    'RTA-GNK-902,Uji Impor Reguler,P,Semarang,04/03/2017,Genuk,Juz 30,01/07/2026,Indent,Data lama,Reguler,Ayah,Ibu,081299990009,Jl. Uji\n'], { type: 'text/csv' }), 's.csv');
  r = await pj('/import/students?dryRun=true', { method: 'POST', body: fd }); ok(r.s === 201 && r.j.ok === true, 'impor: Kategori Subsidi "Reguler" dibaca sebagai tanpa subsidi');
  // impor dalam satu transaksi, kategori subsidi persis sesuai file; satu baris gagal → tidak ada yang tersimpan
  const csv = (lines: string[]) => { const f = new FormData(); f.append('file', new Blob(['ID Santri,Nama Lengkap,Jenis Kelamin,Tempat Lahir,Tanggal Lahir,Cabang,Jenjang,Tanggal Bergabung,Status,Keterangan Pendaftaran,Kategori Subsidi,Nama Ayah,Nama Ibu,No WA Wali,Alamat' + '\n' + lines.join('\n') + '\n'], { type: 'text/csv' }), 's.csv'); return f; };
  const kakak = 'RTA-GNK-903,Uji Kakak Saudara,P,Semarang,04/03/2016,Genuk,Juz 30,01/07/2026,Aktif,Data lama,Saudara,Ayah Uji,Ibu Uji,081299990021,Jl. Uji';
  const adik = 'RTA-GNK-904,Uji Adik Saudara,L,Semarang,05/06/2018,Genuk,Juz 30,01/07/2026,Aktif,Data lama,Saudara,Ayah Uji,Ibu Uji,081299990021,Jl. Uji';
  const tunggal = 'RTA-GNK-905,Uji Tunggal Saudara,P,Semarang,07/08/2017,Genuk,Juz 30,01/07/2026,Aktif,Data lama,Saudara,Ayah Lain,Ibu Lain,081299990022,Jl. Uji';
  const biasa = 'RTA-GNK-906,Uji Baris Biasa,L,Semarang,09/10/2017,Genuk,Juz 30,01/07/2026,Aktif,Data lama,,Ayah B,Ibu B,081299990023,Jl. Uji';
  const ganda = 'RTA-GNK-907,Uji Kolom Santri,P,Semarang,06/05/2018,Genuk,Juz 30,01/07/2026,Aktif,Data lama,,Ayah G,Ibu G,081299990024,Jl. Uji'; // sudah terdaftar
  r = await pj('/import/students?dryRun=true', { method: 'POST', body: csv([biasa, ganda]) });
  ok(r.s === 201 && r.j.ok === false && r.j.errors.length === 1 && r.j.errors[0].row === 3 && /sudah terdaftar/.test(r.j.errors[0].message), 'Periksa dulu menemukan santri ganda di database, dengan nomor baris');
  r = await pj('/import/students', { method: 'POST', body: csv([biasa, ganda]) });
  ok(r.s === 201 && r.j.ok === false && !(await pj('/students?q=Uji Baris Biasa')).j.rows.length, 'impor gagal satu baris → baris lain tidak tersimpan (semua atau tidak sama sekali)');
  r = await pj('/import/students?dryRun=true', { method: 'POST', body: csv([tunggal]) });
  ok(r.s === 201 && r.j.ok === true, 'impor data apa adanya: Saudara tanpa saudara Aktif diterima (data lama)');
  r = await pj('/import/students?dryRun=true', { method: 'POST', body: csv([kakak, adik]) });
  ok(r.s === 201 && r.j.ok === true && !(await pj('/students?q=Uji Kakak Saudara')).j.rows.length, 'Periksa dulu: dua saudara di file yang sama lolos dan tidak menyimpan apa pun');
  r = await pj('/import/students', { method: 'POST', body: csv([kakak, adik]) });
  {
    const std = (await pj('/branches')).j.find((b: any) => b.code === 'GNK').sppStandard;
    const ka = (await pj(`/students/${(await pj('/students?q=Uji Kakak Saudara')).j.rows[0]?.id}`)).j, ad = (await pj(`/students/${(await pj('/students?q=Uji Adik Saudara')).j.rows[0]?.id}`)).j;
    ok(r.s === 201 && r.j.ok === true && r.j.total === 2 && ka.familyId === ad.familyId && ka.subsidyId === S['Saudara'].id && ad.subsidyId === S['Saudara'].id && ka.sppRate === Math.round(std / 2) && ad.sppRate === Math.round(std / 2),
      'impor dua saudara sekeluarga: satu keluarga, masing-masing diskon saudara 50%');
  }
  // kolom subsidi diikuti apa adanya: Saudara tetap Saudara, Reguler tetap Reguler walau orang tuanya sama; lalu edit subsidi per anak
  {
    const r1 = 'RTA-GNK-908,Uji Kakak Reguler Impor,P,Semarang,11/01/2016,Genuk,Juz 30,01/07/2026,Aktif,Data lama,Saudara,Ayah R,Ibu R,081299990051,Jl. Uji';
    const r2 = 'RTA-GNK-909,Uji Adik Reguler Impor,L,Semarang,12/02/2018,Genuk,Juz 30,01/07/2026,Aktif,Data lama,Reguler,Ayah R,Ibu R,081299990051,Jl. Uji';
    const r3 = 'RTA-GNK-910,Uji Anak Tunggal Reguler,L,Semarang,13/03/2018,Genuk,Juz 30,01/07/2026,Aktif,Data lama,,Ayah T,Ibu T,081299990052,Jl. Uji';
    r = await pj('/import/students', { method: 'POST', body: csv([r1, r2, r3]) });
    const std = (await pj('/branches')).j.find((b: any) => b.code === 'GNK').sppStandard;
    const get = async (q: string) => (await pj(`/students/${(await pj(`/students?q=${encodeURIComponent(q)}`)).j.rows[0]?.id}`)).j;
    let a1 = await get('Uji Kakak Reguler Impor'), a2 = await get('Uji Adik Reguler Impor'); const a3 = await get('Uji Anak Tunggal Reguler');
    ok(r.s === 201 && r.j.ok === true && a1.familyId === a2.familyId && a1.subsidyId === S['Saudara'].id && a1.sppRate === Math.round(std / 2) && a2.subsidyId === null && a2.sppRate === std && a3.subsidyId === null,
      'impor sesuai file: kakak Saudara 50%, adik Reguler tetap Reguler walau orang tuanya sama');
    // detail keluarga (menu Wali): subsidi per anak hanya untuk PJ/ustadzah
    r = await pj(`/families/${a1.familyId}`); ok(r.j.students.some((k: any) => k.subsidyLabel === 'Saudara'), 'detail keluarga memuat subsidi tiap anak untuk PJ');
    r = await mn(`/families/${a1.familyId}`); ok(r.s !== 200 || r.j.students.every((k: any) => !('subsidyLabel' in k) && !('sppRate' in k)), 'manajer tidak menerima label/tarif subsidi di detail keluarga');
    // edit manual (menu Wali / Santri → Edit): pasang Saudara di adik; kakak dicabut → adik yang tinggal sendiri ikut Reguler; dipasang lagi → adik ikut
    r = await pj(`/students/${a2.id}`, { method: 'PATCH', body: JSON.stringify({ subsidyId: S['Saudara'].id }) }); a2 = await get('Uji Adik Reguler Impor');
    ok(r.s === 200 && a2.subsidyId === S['Saudara'].id && a2.sppRate === Math.round(std / 2), 'edit subsidi: Reguler → Saudara');
    r = await pj(`/students/${a1.id}`, { method: 'PATCH', body: JSON.stringify({ subsidyId: null }) }); a2 = await get('Uji Adik Reguler Impor');
    ok(r.s === 200 && r.j.subsidiDicabut === 1 && a2.subsidyId === null && a2.sppRate === std, 'edit subsidi: Saudara → Reguler; saudaranya yang tinggal sendiri ikut kembali Reguler');
    r = await pj(`/students/${a1.id}`, { method: 'PATCH', body: JSON.stringify({ subsidyId: S['Saudara'].id }) }); a1 = await get('Uji Kakak Reguler Impor'); a2 = await get('Uji Adik Reguler Impor');
    ok(r.s === 200 && r.j.saudaraIkut === 1 && a1.subsidyId === S['Saudara'].id && a2.subsidyId === S['Saudara'].id, 'pasang lagi Saudara → saudaranya ikut');
  }
}

console.log('SPP bulanan (simulasi tanggal 1)');
{
  // "seakan-akan tanggal 1 bulan depan": jalankan fungsi penjadwal untuk periode bulan depan lewat POST /spp/generate?month=
  const wib = new Date(Date.now() + 7 * 3600_000); const y = wib.getUTCFullYear(), m = wib.getUTCMonth(); // bulan berjalan WIB (0-based)
  const nx = new Date(Date.UTC(y, m + 1, 1)), far = new Date(Date.UTC(y, m + 2, 1));
  const ym = (d: Date) => d.toISOString().slice(0, 7), dmy = (d: Date, day: number) => `${String(day).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  const next = ym(nx), period = next + '-01';
  const label = `SPP ${['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'][nx.getUTCMonth()]} ${nx.getUTCFullYear()}`;
  const f = new FormData(); f.append('file', new Blob(['ID Santri,Nama Lengkap,Jenis Kelamin,Tempat Lahir,Tanggal Lahir,Cabang,Jenjang,Tanggal Bergabung,Status,Keterangan Pendaftaran,Kategori Subsidi,Nama Ayah,Nama Ibu,No WA Wali,Alamat\n' + [
    `RTA-GNK-911,Uji Masuk Tanggal Satu,P,Semarang,01/02/2017,Genuk,Juz 30,${dmy(nx, 1)},Aktif,Data lama,,Ayah S1,Ibu S1,081299990031,Jl. Uji`,
    `RTA-GNK-912,Uji Masuk Tanggal Dua,L,Semarang,02/02/2017,Genuk,Juz 30,${dmy(nx, 2)},Aktif,Data lama,,Ayah S2,Ibu S2,081299990032,Jl. Uji`,
    'RTA-GNK-913,Uji Cuti Tanggal Satu,P,Semarang,03/02/2017,Genuk,Juz 30,01/01/2026,Cuti,Data lama,,Ayah S3,Ibu S3,081299990033,Jl. Uji',
    'RTA-GNK-914,Uji Indent Tanggal Satu,L,Semarang,04/02/2017,Genuk,Juz 30,01/01/2026,Indent,Data lama,,Ayah S4,Ibu S4,081299990034,Jl. Uji',
    'RTA-GNK-915,Uji Santri Lama Tanpa Tanggal,P,Semarang,05/02/2017,Genuk,Juz 30,,Aktif,Mengulang,,Ayah S5,Ibu S5,081299990035,Jl. Uji', // tgl bergabung kosong = santri lama
  ].join('\n') + '\n'], { type: 'text/csv' }), 's.csv');
  r = await pj('/import/students', { method: 'POST', body: f }); ok(r.s === 201 && r.j.ok === true && r.j.total === 5, 'santri uji tanggal 1 diimpor ' + JSON.stringify(r.j.errors ?? r.j));
  const sid = async (q: string) => (await pj(`/students?q=${encodeURIComponent(q)}`)).j.rows[0]?.id;
  const sppOf = async (q: string) => { const id = await sid(q); return { id, st: (await pj(`/students/${id}`)).j, inv: (await pj(`/spp/students/${id}/invoices`)).j.filter((i: any) => i.type === 'SPP' && i.period === period) }; };
  const before = await sppOf('Uji Masuk Tanggal Satu'); ok(before.inv.length === 0, `sebelum tanggal 1 ${next}: belum ada tagihan SPP`);

  r = await us(`/spp/generate?month=${next}`, { method: 'POST' }); ok(r.s === 403, 'ustadzah tidak bisa memicu tagihan SPP');
  r = await mn(`/spp/generate?month=${next}`, { method: 'POST' }); ok(r.s === 403, 'manajer tidak bisa memicu tagihan SPP');
  r = await pj('/spp/generate?month=2026-13', { method: 'POST' }); ok(r.s === 400, 'format bulan salah ditolak');
  r = await pj(`/spp/generate?month=${ym(far)}`, { method: 'POST' }); ok(r.s === 400, 'tagihan lebih dari satu bulan ke depan ditolak');

  r = await pj(`/spp/generate?month=${next}`, { method: 'POST' });
  ok(r.s === 201 && r.j.created > 0 && r.j.period === period, `tanggal 1 ${next}: ${r.j.created} tagihan SPP dibuat`);
  const t1 = await sppOf('Uji Masuk Tanggal Satu');
  ok(t1.inv.length === 1 && t1.inv[0].amount === t1.st.sppRate && t1.inv[0].label === label && t1.inv[0].status === 'BELUM', `santri Aktif yang masuk tepat tgl 1 ditagih: ${t1.inv[0]?.label} ${t1.inv[0]?.amount}, status ${t1.inv[0]?.status}`);
  ok((await sppOf('Uji Masuk Tanggal Dua')).inv.length === 0, 'santri yang masuk tgl 2 belum ditagih bulan itu');
  ok((await sppOf('Uji Cuti Tanggal Satu')).inv.length === 0 && (await sppOf('Uji Indent Tanggal Satu')).inv.length === 0, 'santri Cuti & Indent tidak ditagih SPP');
  {
    const lama = await sppOf('Uji Santri Lama Tanpa Tanggal');
    const all = (await pj(`/spp/students/${lama.id}/invoices`)).j;
    ok(lama.st.joinDate === null && lama.inv.length === 1 && !all.some((i: any) => i.type === 'PENDAFTARAN') && lama.st.history[0]?.effectiveDate,
      'tgl bergabung kosong = santri lama: tetap ditagih SPP, tanpa tagihan pendaftaran, riwayat status tetap bertanggal');
    const reg = (await pj('/registrations')).j; ok(!JSON.stringify(reg).includes('Uji Santri Lama Tanpa Tanggal'), 'santri lama tanpa tgl bergabung tidak muncul di menu Pendaftaran');
  }
  const ka = await sppOf('Uji Kakak Saudara');
  ok(ka.inv.length === 1 && ka.inv[0].amount === ka.st.sppRate && ka.st.subsidyId != null, `santri bersubsidi ditagih sesuai tarifnya (${ka.inv[0]?.amount})`);
  r = await pj(`/spp/generate?month=${next}`, { method: 'POST' }); ok(r.s === 201 && r.j.created === 0, 'dijalankan ulang (penjadwal tiap jam) → tidak ada tagihan ganda');
  r = await pj('/audit?entity=invoice'); ok(r.s === 200 && JSON.stringify(r.j).includes(period), 'pemicu manual tercatat di audit');
}

console.log('Agenda');
{
  const base = { category: 'KEGIATAN', startDate: '2027-03-10' };
  r = await pj('/agenda', { method: 'POST', body: JSON.stringify({ ...base, title: 'Libur uji semua cabang', category: 'LIBUR', endDate: '2027-03-12' }) }); ok(r.s === 201, 'PJ membuat agenda untuk semua cabang');
  const umum = r.j.id;
  r = await pj('/agenda', { method: 'POST', body: JSON.stringify({ ...base, title: 'Rapat uji Genuk', category: 'RAPAT', branchId: gnk.id, startTime: '09:00', endTime: '11:00', location: 'Aula' }) }); ok(r.s === 201, 'PJ membuat agenda khusus cabang Genuk');
  const genuk = r.j.id;
  r = await pj('/agenda', { method: 'POST', body: JSON.stringify({ ...base, title: 'Tanggal terbalik', endDate: '2027-03-01' }) }); ok(r.s === 400, 'tanggal selesai sebelum tanggal mulai ditolak');
  r = await pj('/agenda', { method: 'POST', body: JSON.stringify({ ...base, title: 'Jam terbalik', startTime: '10:00', endTime: '08:00' }) }); ok(r.s === 400, 'jam selesai sebelum jam mulai ditolak');
  r = await pj('/agenda', { method: 'POST', body: JSON.stringify({ ...base, title: 'Kategori aneh', category: 'PESTA' }) }); ok(r.s === 400, 'kategori tidak dikenal ditolak');
  r = await us('/agenda', { method: 'POST', body: JSON.stringify({ ...base, title: 'Agenda ustadzah', branchId: spyb.id }) }); ok(r.s === 403, 'ustadzah tidak bisa membuat agenda (hanya baca)');
  r = await mn('/agenda', { method: 'POST', body: JSON.stringify({ ...base, title: 'Agenda manajer' }) }); ok(r.s === 403, 'manajer tidak bisa membuat agenda');
  r = await us('/agenda?from=2027-03-01&to=2027-03-31'); ok(r.s === 200 && r.j.rows.some((a: any) => a.id === umum) && !r.j.rows.some((a: any) => a.id === genuk), 'ustadzah Supriyadi melihat agenda umum, bukan agenda Genuk');
  r = await us(`/agenda/${genuk}`); ok(r.s === 404, 'agenda cabang lain ditolak (404)');
  r = await us(`/agenda?from=2027-03-01&to=2027-03-31&branchId=${gnk.id}`); ok(r.s === 404, 'ustadzah tidak bisa menyaring cabang di luar scope (404)');
  r = await mn('/agenda?from=2027-03-01&to=2027-03-31'); ok(r.s === 200 && r.j.rows.some((a: any) => a.id === genuk), 'manajer melihat agenda semua cabang');
  r = await pj(`/agenda?from=2027-03-01&to=2027-03-31&branchId=${spyb.id}`); ok(r.s === 200 && r.j.rows.some((a: any) => a.id === umum) && !r.j.rows.some((a: any) => a.id === genuk), 'filter cabang Supriyadi: agenda umum ikut, Genuk tidak');
  r = await pj(`/agenda/${genuk}`); ok(r.s === 200 && r.j.startTime === '09:00' && r.j.endTime === '11:00' && r.j.branchName === 'Genuk', 'detail agenda: jam & cabang terbaca');
  r = await pj('/agenda?from=2027-03-01&to=2028-12-31'); ok(r.s === 400, 'rentang lebih dari setahun ditolak');
  r = await pj(`/agenda/${genuk}`, { method: 'PATCH', body: JSON.stringify({ ...base, title: 'Rapat wali uji Genuk', category: 'RAPAT', branchId: gnk.id, startDate: '2027-03-11' }) }); ok(r.s === 200, 'PJ mengubah agenda');
  r = await us(`/agenda/${umum}`, { method: 'PATCH', body: JSON.stringify({ ...base, title: 'Diubah ustadzah' }) }); ok(r.s === 403, 'ustadzah tidak bisa mengubah agenda');
  r = await pj(`/agenda/${genuk}/cancel`, { method: 'POST', body: JSON.stringify({}) }); ok(r.s === 400, 'batal agenda tanpa alasan ditolak');
  r = await pj(`/agenda/${genuk}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Diundur' }) }); ok(r.s === 201, 'PJ membatalkan agenda dengan alasan');
  r = await pj(`/agenda/${genuk}`, { method: 'PATCH', body: JSON.stringify({ ...base, title: 'Ubah setelah batal' }) }); ok(r.s === 400, 'agenda yang dibatalkan tidak bisa diubah');
  r = await pj('/agenda?from=2027-03-01&to=2027-03-31'); ok(!r.j.rows.some((a: any) => a.id === genuk), 'agenda batal tidak tampil secara bawaan');
  r = await pj('/agenda?from=2027-03-01&to=2027-03-31&includeCancelled=1'); const batal = r.j.rows.find((a: any) => a.id === genuk);
  ok(!!batal && batal.cancelReason === 'Diundur' && batal.title === 'Rapat wali uji Genuk', 'agenda batal tetap tersimpan (tidak dihapus) beserta alasannya');
  r = await pj(`/audit?entity=agenda`); ok(r.s === 200 && ['create', 'update', 'cancel'].every((a) => JSON.stringify(r.j).includes(`"${a}"`)), 'buat, ubah, batal agenda tercatat di audit');
}

console.log('Pendaftaran (cicilan)');
{
  const wib = (d: number) => new Date(Date.now() + 7 * 3600_000 + d * 86_400_000).toISOString().slice(0, 10); // tanggal WIB ± d hari
  const plusMonth = (ymd: string, n: number) => { const [y, m, d] = ymd.split('-').map(Number); const last = new Date(Date.UTC(y, m + n, 0)).getUTCDate(); return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10); };
  const today = wib(0);
  const pdr = (await pj('/branches')).j.find((b: any) => b.code === 'PDR'); const fee = pdr.registrationFee;
  const cls = (await pj('/classes')).j.find((c: any) => c.branchId === pdr.id && c.level === 'JUZ30');
  const mk = async (fullName: string, wa: string) => (await pj('/students', { method: 'POST', body: JSON.stringify({ fullName, gender: 'P', birthPlace: 'Semarang', birthDate: '2019-02-03',
    branchId: pdr.id, classId: cls.id, joinDate: today, status: 'AKTIF', family: { fatherName: `Ayah ${fullName}`, motherName: 'Ibu Uji', waPhone: wa, address: 'Jl. Uji' } }) })).j;
  const rowOf = async (id: number) => (await pj('/registrations')).j.rows.find((x: any) => x.studentId === id);
  const plan = (id: number, body: any, who = pj) => who(`/registrations/${id}/plan`, { method: 'POST', body: JSON.stringify(body) });
  const payFd = (familyId: number, ids: number[], amount: number) => { const f = new FormData(); f.append('familyId', String(familyId)); f.append('invoiceIds', ids.join(',')); f.append('amount', String(amount)); f.append('paidAt', today); f.append('method', 'TUNAI'); f.append('matched', 'true'); return f; };

  const a = await mk('Uji Cicil Tiga', '081299990061');
  let row = await rowOf(a.id);
  ok(row && row.scheme === 'BELUM_DIATUR' && row.fee === fee && row.status === 'BELUM_BAYAR', `santri baru masuk menu Pendaftaran: skema belum diatur, belum bayar ${fee}`);
  r = await mn('/registrations'); ok(r.s === 200 && r.j.minDp === 100000 && r.j.maxInstallments === 3, 'manajer bisa melihat menu Pendaftaran; aturan dari Pengaturan (DP min Rp100.000, maks 3 kali)');
  r = await us('/registrations'); ok(r.s === 200 && r.j.rows.every((x: any) => x.branchName === 'Supriyadi'), 'ustadzah hanya melihat pendaftaran cabangnya');
  r = await plan(a.id, { scheme: 'CICIL', count: 3, dp: 100000 }, us); ok(r.s === 403, 'ustadzah tidak bisa mengatur skema cicilan');
  r = await plan(a.id, { scheme: 'CICIL', count: 3, dp: 75000 }); ok(r.s === 400 && /DP minimal/.test(r.j.message), 'DP di bawah minimal ditolak');
  r = await plan(a.id, { scheme: 'CICIL', count: 4, dp: 100000 }); ok(r.s === 400, 'lebih dari maksimal kali bayar ditolak');
  r = await plan(a.id, { scheme: 'CICIL', count: 3, dp: 100000, dueDates: [today, today, plusMonth(today, 1)] }); ok(r.s === 400 && /bulan yang berbeda/.test(r.j.message), 'jatuh tempo di bulan yang sama ditolak');
  r = await plan(a.id, { scheme: 'CICIL', count: 3, dp: 100000 });
  const each = Math.floor((fee - 100000) / 2 / 1000) * 1000;
  ok(r.s === 201 && r.j.invoices.length === 3 && r.j.invoices.map((i: any) => i.amount).join() === [100000, each, fee - 100000 - each].join()
    && r.j.invoices.map((i: any) => i.dueDate).join() === [today, plusMonth(today, 1), plusMonth(today, 2)].join(), `cicil 3 kali: DP + sisa dibagi rata, jatuh tempo per bulan (${r.j.invoices.map((i: any) => i.amount).join(' / ')})`);
  const [dp, c2, c3] = r.j.invoices;
  row = await rowOf(a.id);
  ok(row.scheme === 'CICIL' && row.count === 3 && row.installments.map((i: any) => i.status).join() === 'BELUM,TERJADWAL,TERJADWAL', 'DP jatuh tempo hari ini (Belum bayar); cicilan berikutnya Terjadwal');
  r = await pj(`/spp/students/${a.id}/invoices`); ok(r.j.filter((i: any) => i.type === 'PENDAFTARAN').length === 3, 'tagihan pendaftaran lama dibatalkan (voided) dan diganti 3 tagihan cicilan');
  r = await pj(`/bayar/families/${a.familyId}/invoices`); const r2 = await pj(`/bayar/families/${a.familyId}/invoices?terjadwal=1`);
  ok(r.j.length === 1 && r.j[0].id === dp.id && r2.j.length === 3, 'menu Bayar: hanya DP yang ditagihkan; cicilan terjadwal ikut hanya saat catat bayar / lunasi lebih awal');
  r = await pj(`/bayar/families/${a.familyId}/link`, { method: 'POST' }); ok(r.s === 201 && r.j.total === 100000, 'pesan WA wali hanya berisi cicilan yang jatuh tempo (DP)');
  r = await pj('/bayar/payments', { method: 'POST', body: payFd(a.familyId, [dp.id], 100000) }); ok(r.s === 201 && r.j.state === 'TERVERIFIKASI', 'DP dicatat & diverifikasi');
  row = await rowOf(a.id);
  ok(row.status === 'CICILAN' && row.paid === 100000 && row.paidCount === 1 && row.next.id === c2.id, 'setelah DP: Cicilan berjalan 1/3, berikutnya cicilan 2');
  r = await plan(a.id, { scheme: 'LUNAS' }); ok(r.s === 400 && /Sudah ada pembayaran/.test(r.j.message), 'skema tidak bisa diubah setelah ada pembayaran');
  r = await pj('/bayar/payments', { method: 'POST', body: payFd(a.familyId, [c2.id], c2.amount - 1000) }); ok(r.s === 400, 'cicilan tetap harus sesuai nominal (bukan bayar sebagian)');
  r = await pj('/bayar/payments', { method: 'POST', body: payFd(a.familyId, [c2.id, c3.id], c2.amount + c3.amount) });
  row = await rowOf(a.id); ok(r.s === 201 && row.status === 'LUNAS' && row.sisa === 0, 'lunasi sisa lebih awal (cicilan terjadwal) → Lunas');
  r = await pj(`/audit?entity=student&entityId=${a.id}`); ok(r.j.some((x: any) => x.action === 'atur_skema_pendaftaran'), 'pengaturan skema tercatat di audit');

  const b = await mk('Uji Cicil Telat', '081299990062');
  await plan(b.id, { scheme: 'CICIL', count: 2, dp: 100000, dueDates: [wib(-9), plusMonth(wib(-9), 1)] });
  row = await rowOf(b.id); ok(row.status === 'TERLAMBAT' && row.installments[0].status === 'TUNGGAKAN', 'DP lewat jatuh tempo → Terlambat');
  const c = await mk('Uji Lunas Langsung', '081299990063');
  r = await plan(c.id, { scheme: 'LUNAS' }); row = await rowOf(c.id); ok(r.s === 201 && row.scheme === 'LUNAS' && row.count === 1 && row.fee === fee, 'skema lunas langsung: satu tagihan');
  await pj('/settings', { method: 'PATCH', body: JSON.stringify({ registrationMaxInstallments: 2 }) });
  const d2 = await mk('Uji Batas Cicilan', '081299990064');
  r = await plan(d2.id, { scheme: 'CICIL', count: 3, dp: 100000 }); ok(r.s === 400, 'maksimal kali bayar mengikuti Pengaturan');
  await pj('/settings', { method: 'PATCH', body: JSON.stringify({ registrationMaxInstallments: 3 }) });
}

console.log('Kas');
{
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const fd = (o: Record<string, any>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, typeof v === 'string' ? v : JSON.stringify(v)); return f; };
  const post = (who: any, path: string, body: any) => who(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) });
  let c = (await pj('/kas/catalog')).j;
  ok(c.itemCategories.length >= 3 && c.expenseCategories.length >= 6, 'kategori bawaan Kas tersedia (barang & pengeluaran)');
  const spy = c.branches.find((b: any) => b.name === 'Supriyadi'), gnk = c.branches.find((b: any) => b.name === 'Genuk');
  r = await post(us, '/kas/item-categories', { name: 'Uji Kategori' }); ok(r.s === 403, 'ustadzah tidak bisa mengatur kategori barang');
  r = await post(pj, '/kas/item-categories', { name: 'Uji Kategori', icon: 'STAR' }); const catId = r.j.id; ok(r.s === 201, 'PJ menambah kategori barang');
  r = await post(pj, '/kas/item-categories', { name: 'uji kategori' }); ok(r.s === 400 && /sudah ada/.test(r.j.message), 'nama kategori ganda ditolak');
  r = await post(pj, '/kas/items', { categoryId: catId, name: 'Uji Iqro', price: 25000 }); const itemId = r.j.id; ok(r.s === 201, 'PJ menambah jenis barang dalam kategori');
  r = await post(us, `/kas/items/${itemId}/stock`, { branchId: spy.id, delta: 5, note: 'Stok awal' }); ok(r.s === 403, 'ustadzah tidak bisa mengoreksi stok');
  r = await post(pj, `/kas/items/${itemId}/stock`, { branchId: spy.id, delta: 5, note: 'Stok awal' }); ok(r.s === 201 && r.j.qty === 5, 'PJ mengisi stok awal per cabang (Supriyadi 5)');
  r = await post(pj, `/kas/items/${itemId}/stock`, { branchId: spy.id, delta: -9, note: 'Hilang' }); ok(r.s === 400, 'stok tidak boleh minus');
  const stockAt = async (b: number) => (await pj(`/kas/catalog?branchId=${b}`)).j.itemCategories.flatMap((x: any) => x.items).find((i: any) => i.id === itemId).stock;
  ok((await stockAt(gnk.id)) === 0, 'stok per cabang: Genuk tetap 0');

  r = await us('/kas/students?q='); const stu = r.j[0]; ok(r.s === 200 && r.j.every((x: any) => x.branchName === 'Supriyadi'), 'ustadzah hanya bisa memilih santri cabangnya');
  r = await post(us, '/kas/sales', fd({ studentId: String(stu.id), method: 'TUNAI', items: [{ itemId, qty: 6 }] })); ok(r.s === 400 && /Stok/.test(r.j.message), 'jual melebihi stok cabang ditolak');
  r = await post(us, '/kas/sales', fd({ studentId: String(stu.id), method: 'TRANSFER', items: [{ itemId, qty: 1 }] })); ok(r.s === 400 && /Bukti/.test(r.j.message), 'jual transfer tanpa bukti ditolak');
  r = await post(us, '/kas/sales', fd({ studentId: String(stu.id), method: 'TUNAI', items: [{ itemId, qty: 2 }] })); const cash = r.j; ok(r.s === 201 && r.j.total === 50000 && !r.j.invoiceId, 'ustadzah menjual tunai (2 × Rp25.000)');
  r = await post(us, '/kas/sales', fd({ studentId: String(stu.id), method: 'TAGIHAN', items: [{ itemId, qty: 1 }] })); const tag = r.j; ok(r.s === 201 && !!r.j.invoiceId, 'jual dengan cara "Tagihkan ke wali"');
  r = await pj(`/bayar/families/${stu.familyId}/invoices`); ok(r.j.some((i: any) => i.id === tag.invoiceId && i.type === 'BARANG' && i.amount === 25000), 'tagihan barang muncul di menu Bayar keluarga');
  r = await post(us, '/kas/sales', fd({ studentId: String(stu.id), method: 'TAGIHAN', items: [{ itemId, qty: 1 }] })); const tag2 = r.j; ok(r.s === 201, 'tagihan barang kedua di hari yang sama tetap bisa');
  ok((await stockAt(spy.id)) === 1, 'stok cabang berkurang otomatis (5 → 1)');
  r = await post(us, `/kas/sales/${tag2.id}/cancel`, { reason: 'Salah input' }); ok(r.s === 403, 'ustadzah tidak bisa membatalkan penjualan');
  r = await post(pj, `/kas/sales/${tag2.id}/cancel`, { reason: 'Salah input' }); ok(r.s === 201, 'PJ membatalkan penjualan');
  r = await pj(`/bayar/families/${stu.familyId}/invoices`); ok(!r.j.some((i: any) => i.id === tag2.invoiceId) && (await stockAt(spy.id)) === 2, 'batal: tagihan barang dibatalkan & stok kembali');
  const pay = fd({ familyId: String(stu.familyId), invoiceIds: String(tag.invoiceId), amount: '25000', paidAt: today, method: 'TUNAI', matched: 'true' });
  r = await post(pj, '/bayar/payments', pay); ok(r.s === 201 && r.j.state === 'TERVERIFIKASI', 'tagihan barang dibayar lewat menu Bayar');
  r = await post(pj, `/kas/sales/${tag.id}/cancel`, { reason: 'Coba batal' }); ok(r.s === 400 && /sudah dibayar/.test(r.j.message), 'penjualan yang tagihannya sudah dibayar tidak bisa dibatalkan');
  r = await pj(`/kas/students/${stu.id}/sales`); ok(r.s === 200 && r.j.rows.length >= 3 && r.j.rows.find((x: any) => x.id === tag.id).invoiceStatus === 'LUNAS', 'tab Pembelian santri: riwayat & status tagihan barang');

  const ecat = c.expenseCategories.find((x: any) => x.isActive).id;
  const before = (await pj(`/kas?branchId=${spy.id}`)).j.summary;
  r = await post(us, '/kas/expenses', fd({ categoryId: String(ecat), amount: '65000', description: 'Spidol uji', method: 'TUNAI', restock: [{ itemId, qty: 3 }] })); const ex = r.j;
  ok(r.s === 201 && r.j.state === 'MENUNGGU', 'pengeluaran ustadzah menunggu persetujuan PJ');
  let k = (await pj(`/kas?branchId=${spy.id}`)).j.summary; ok(k.keluar === before.keluar && k.menunggu === before.menunggu + 1 && (await stockAt(spy.id)) === 2, 'menunggu: belum masuk laporan kas & stok belum bertambah');
  r = await post(us, `/kas/expenses/${ex.id}/approve`, {}); ok(r.s === 403, 'ustadzah tidak bisa menyetujui pengeluaran');
  r = await post(pj, `/kas/expenses/${ex.id}/approve`, {}); k = (await pj(`/kas?branchId=${spy.id}`)).j.summary;
  ok(r.s === 201 && k.keluar === before.keluar + 65000 && (await stockAt(spy.id)) === 5, 'PJ menyetujui: masuk laporan kas & stok restock +3');
  r = await post(pj, `/kas/expenses/${ex.id}/decline`, { reason: 'Nota ganda' }); ok(r.s === 201 && r.j.state === 'DIBATALKAN' && (await stockAt(spy.id)) === 2, 'PJ membatalkan pengeluaran disetujui: stok restock ditarik');
  r = await post(us, '/kas/expenses', fd({ branchId: String(gnk.id), categoryId: String(ecat), amount: '10000', description: 'Uji cabang lain', method: 'TUNAI' })); ok(r.s === 404, 'ustadzah tidak bisa mencatat pengeluaran cabang lain');
  r = await post(pj, '/kas/expenses', fd({ branchId: String(gnk.id), categoryId: String(ecat), amount: '10000', description: 'Uji PJ langsung', method: 'TRANSFER' })); ok(r.s === 201 && r.j.state === 'DISETUJUI', 'pengeluaran PJ langsung disetujui');
  r = await us('/kas'); ok(r.s === 200 && !r.j.transactions.some((t: any) => t.title === 'Uji PJ langsung'), 'ustadzah hanya melihat kas cabangnya');
  r = await pj('/kas'); ok(r.j.categories.masuk.some((x: any) => x.label === 'Uji Kategori') && r.j.transactions.some((t: any) => t.key === `s-${cash.id}` && t.counted), 'penjualan tunai masuk pemasukan kas, dirinci per kategori barang');
  ok(r.j.transactions.filter((t: any) => t.kind === 'MASUK').every((t: any) => t.category === 'Pelunasan tagihan barang') && r.j.transactions.some((t: any) => t.saleId === tag.id && t.counted)
    && !r.j.categories.masuk.some((x: any) => ['SPP', 'Pendaftaran', 'Daftar ulang'].includes(x.label)), 'pembukuan terpisah: Kas tanpa uang SPP/pendaftaran; tagihan barang yang dibayar masuk Kas');
  r = await mn('/kas'); const r2 = await post(mn, '/kas/sales', fd({ studentId: String(stu.id), method: 'TUNAI', items: [{ itemId, qty: 1 }] }));
  ok(r.s === 200 && r2.s === 403, 'manajer hanya melihat Kas');
  r = await mn('/kas/export.pdf'); ok(r.s === 200 && String(r.j).startsWith('%PDF'), 'ekspor laporan kas (PDF)');
  r = await pj(`/kas/export.xlsx?branchId=${spy.id}`); ok(r.s === 200 && String(r.j).startsWith('PK'), 'ekspor laporan kas (Excel)');
  r = await us('/kas/export.xlsx'); ok(r.s === 403, 'ustadzah tidak bisa mengekspor kas');
  r = await pj(`/kas/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ isActive: false }) });
  r = await post(us, '/kas/sales', fd({ studentId: String(stu.id), method: 'TUNAI', items: [{ itemId, qty: 1 }] })); ok(r.s === 400, 'barang nonaktif tidak bisa dijual');
  r = await pj(`/kas/expense-categories/${ecat}`, { method: 'PATCH', body: JSON.stringify({ isActive: false }) }); c = (await pj('/kas/catalog')).j;
  ok(r.s === 200 && c.expenseCategories.find((x: any) => x.id === ecat).isActive === false, 'kategori pengeluaran bisa dinonaktifkan (tidak dihapus)');
  await pj(`/kas/expense-categories/${ecat}`, { method: 'PATCH', body: JSON.stringify({ isActive: true }) });
  r = await pj(`/audit?entity=sale&entityId=${cash.id}`); ok(r.j.some((x: any) => x.action === 'jual_barang'), 'penjualan tercatat di audit');
}

console.log('Ekspor & pembukuan SPP / Pendaftaran');
{
  r = await pj('/spp/summary'); ok(r.s === 200 && r.j.daftarUlang && typeof r.j.daftarUlang.tagihan === 'number', 'ringkasan SPP memuat uang daftar ulang tahun berjalan');
  for (const [path, who, name] of [['/spp/export.xlsx', pj, 'SPP Excel (PJ)'], ['/spp/export.pdf', mn, 'SPP PDF (manajer)'], ['/registrations/export.xlsx', mn, 'Pendaftaran Excel (manajer)'], ['/registrations/export.pdf', pj, 'Pendaftaran PDF (PJ)']] as const) {
    r = await (who as any)(path); ok(r.s === 200 && /^(PK|%PDF)/.test(String(r.j)), `ekspor ${name}`);
  }
  r = await us('/spp/export.xlsx'); const r2 = await us('/registrations/export.pdf'); ok(r.s === 403 && r2.s === 403, 'ustadzah tidak bisa mengekspor SPP/Pendaftaran');
  r = await pj('/spp/export.xlsx?month=2026-13'); ok(r.s === 400, 'bulan ekspor tidak valid ditolak');
}

console.log('Profil & dashboard');
const pjs = await login2('pj@rta.local'); const pj2 = api(pjs);
r = await pj2('/auth/profile'); ok(r.s === 200 && r.j.role === 'PJ', 'profil terbaca');
r = await pj2('/auth/profile', { method: 'PATCH', body: JSON.stringify({ phone: '12345' }) }); ok(r.s === 400, 'no. WA tidak valid ditolak');
r = await pj2('/auth/prefs', { method: 'PATCH', body: JSON.stringify({ textSize: 'besar', hack: 1 }) }); ok(r.s === 200, 'preferensi disimpan');
r = await pj2('/auth/sessions'); ok(r.s === 200 && r.j.some((x: any) => x.current) && r.j.length >= 2, `perangkat aktif: ${r.j.length}, satu ditandai "perangkat ini"`);
const other = r.j.find((x: any) => !x.current); r = await pj2(`/auth/sessions/${other.id}/revoke`, { method: 'POST' }); ok(r.s === 200, 'keluarkan perangkat lain');
r = await us('/dashboard'); ok(r.s === 200 && r.j.keuangan && r.j.hafalan.perClass.length === 2, `dashboard ustadzah: keuangan + ${r.j.hafalan.perClass.length} kelas hafalan, belum input ${r.j.hafalan.belumInputPekanIni}`);
ok(r.j.perBranch.every((b: any) => b.branchName === 'Supriyadi') && r.j.santri.putra + r.j.santri.putri === r.j.santri.aktif && Array.isArray(r.j.tindakan.requests) && typeof r.j.tindakan.count.mutasi === "number",
  `dashboard ustadzah hanya cabang Supriyadi; putra ${r.j.santri.putra} + putri ${r.j.santri.putri} = aktif`);
r = await pj2('/dashboard'); ok(r.s === 200 && new Set(r.j.perBranch.map((b: any) => b.branchName)).size > 1 && Array.isArray(r.j.tindakan.payments), `dashboard PJ: ${new Set(r.j.perBranch.map((b: any) => b.branchName)).size} cabang`);
{ // kotak Keuangan Beranda: tiga tab, angka sama dengan menu masing-masing (pembukuan terpisah)
  const f = r.j.finance, [sp, rg, ks] = await Promise.all([pj2('/spp/summary'), pj2('/registrations'), pj2('/kas')]);
  ok(f && f.spp && f.pendaftaran && f.kas, 'dashboard PJ: kotak keuangan punya tab SPP, Pendaftaran, Kas');
  ok(f.spp.tagihan === sp.j.money.tagihan && f.spp.terbayar === sp.j.money.terbayar && f.spp.tunggakan === sp.j.money.tunggakan && f.spp.terbayar + f.spp.menunggu + f.spp.belum === f.spp.tagihan,
    `tab SPP = menu SPP (terbayar ${f.spp.terbayar} dari ${f.spp.tagihan})`);
  ok(f.pendaftaran.terkumpul === rg.j.summary.terkumpul && f.pendaftaran.target === rg.j.summary.target && f.pendaftaran.santri === rg.j.summary.total,
    `tab Pendaftaran = menu Pendaftaran (terkumpul ${f.pendaftaran.terkumpul} dari ${f.pendaftaran.target})`);
  ok(f.kas.masuk === ks.j.summary.masuk && f.kas.keluar === ks.j.summary.keluar && f.kas.keluarTerbesar.length <= 3, `tab Kas = menu Kas (masuk ${f.kas.masuk}, keluar ${f.kas.keluar})`);
  ok(!/subsid/i.test(JSON.stringify(f)), 'kotak keuangan tanpa label subsidi');
  const spy = (await pj2('/branches')).j.find((b: any) => b.name === 'Supriyadi');
  const [fb, kb] = await Promise.all([pj2(`/dashboard?branchId=${spy.id}`), pj2(`/kas?branchId=${spy.id}`)]);
  ok(fb.j.finance.kas.masuk === kb.j.summary.masuk && fb.j.finance.pendaftaran.santri <= f.pendaftaran.santri, 'filter cabang ikut ke kotak keuangan');
  const fu = (await us('/dashboard')).j.finance, ku = (await us('/kas')).j;
  ok(fu && fu.kas.masuk === ku.summary.masuk && fu.spp, 'kotak keuangan ustadzah: hanya cabangnya');
}
console.log(fails ? `\n${fails} GAGAL` : '\nSEMUA LULUS');
process.exit(fails ? 1 : 0);
