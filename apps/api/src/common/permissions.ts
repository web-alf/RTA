// Daftar menu dan aksi (sumber kebenaran untuk matriks Role)
export const MENUS = ['dashboard', 'spp', 'bayar', 'lps', 'kelas', 'santri', 'ustadzah', 'wali', 'pengajuan', 'role', 'akun', 'audit', 'pengaturan', 'agenda', 'pendaftaran', 'kas', 'portal'] as const;
export const ACTIONS = ['lihat', 'input', 'edit', 'ekspor', 'impor', 'setujui'] as const;
export type Perm = `${(typeof MENUS)[number]}.${(typeof ACTIONS)[number]}`;

const all = (menu: string, acts: string[]) => acts.map((a) => `${menu}.${a}`);
const full = (menu: string) => all(menu, ['lihat', 'input', 'edit', 'ekspor', 'impor']);
const lihatEkspor = (menu: string) => all(menu, ['lihat', 'ekspor']);

// Matriks default (prd.md 4.2 + keputusan desain: SPP = rekap, Bayar = kerja harian, LPS ustadzah hanya baca).
// pengaturan.input = ubah rekening transfer cabang (scope cabang); pengaturan.edit = semua nilai Pengaturan.
// Admin Sistem digabung ke PJ (migrasi 004). Menu "portal" = halaman Anak Saya, khusus akun wali (data keluarganya sendiri).
export const DEFAULT_ROLE_PERMS: Record<string, string[]> = {
  PJ: [
    ...full('dashboard'), ...full('spp'), ...full('bayar'), ...all('bayar', ['setujui']), ...full('lps'), ...all('lps', ['setujui']),
    ...full('kelas'), ...full('santri'), ...full('ustadzah'), ...full('wali'), ...all('pengajuan', ['lihat', 'input', 'setujui']),
    ...full('role'), ...full('akun'), ...all('audit', ['lihat']), ...all('pengaturan', ['lihat', 'input', 'edit']),
    ...all('agenda', ['lihat', 'input', 'edit']), ...all('pendaftaran', ['lihat', 'edit', 'ekspor']),
    ...all('kas', ['lihat', 'input', 'edit', 'ekspor', 'setujui']), // kas.edit = kelola kategori/barang/stok; kas.setujui = setujui pengeluaran & batalkan penjualan
  ],
  USTADZAH: [
    ...lihatEkspor('dashboard'), ...all('spp', ['lihat']), ...all('bayar', ['lihat', 'input']), ...all('lps', ['lihat']),
    ...all('kelas', ['lihat', 'input']), ...all('santri', ['lihat', 'input', 'edit', 'ekspor', 'impor']),
    ...all('wali', ['lihat', 'input', 'edit']), ...all('pengajuan', ['lihat', 'input']), ...all('agenda', ['lihat']), ...all('pendaftaran', ['lihat']),
    ...all('pengaturan', ['lihat', 'input']), // pengaturan.input = ubah rekening cabang sendiri; nilai lain hanya baca
    ...all('kas', ['lihat', 'input']),        // jual barang & catat pengeluaran cabangnya (pengeluaran menunggu PJ)
  ],
  MANAJER: [
    ...lihatEkspor('dashboard'), ...lihatEkspor('spp'), ...all('bayar', ['lihat']), ...lihatEkspor('lps'), ...lihatEkspor('kelas'),
    ...lihatEkspor('santri'), ...lihatEkspor('ustadzah'), ...lihatEkspor('wali'), ...all('pengajuan', ['lihat']), ...all('pengaturan', ['lihat']), ...all('agenda', ['lihat']), ...lihatEkspor('pendaftaran'),
    ...lihatEkspor('kas'),
  ],
  WALI: [...all('portal', ['lihat', 'input'])],
};

// Role yang boleh melihat field sensitif (PJ + ustadzah cabang terkait). Manajer & wali dimasking.
export const SENSITIVE_ROLES = ['PJ', 'USTADZAH'];
