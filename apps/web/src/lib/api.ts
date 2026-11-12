/** Klien API: token akses di memori, refresh otomatis lewat cookie httpOnly. */
export type AuthUser = { id: number; name: string; email: string; role: string; perms: string[]; branchIds: number[] | null; mustChangePassword: boolean };
let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
export const setToken = (t: string | null) => { accessToken = t; };
export const setOnUnauthorized = (fn: () => void) => { onUnauthorized = fn; };

export class ApiError extends Error { constructor(public status: number, message: string, public details?: string[]) { super(message); } }

async function raw(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { ...(init.headers as any) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (!(init.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  return fetch(`/api${path}`, { ...init, headers, credentials: 'include' });
}

let inflight: Promise<{ user: AuthUser; accessToken: string } | null> | null = null;
/** Refresh single-flight: beberapa pemanggil bersamaan memakai satu request (token refresh dirotasi, jadi tidak boleh dipakai dua kali). */
export function refresh(): Promise<{ user: AuthUser; accessToken: string } | null> {
  if (!inflight) inflight = (async () => {
    try { const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' }); if (!r.ok) return null; const data = await r.json(); accessToken = data.accessToken; return data; }
    finally { setTimeout(() => { inflight = null; }, 0); }
  })();
  return inflight;
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  let r = await raw(path, init);
  if (r.status === 401 && !path.startsWith('/auth/')) {
    const ok = await refresh();
    if (!ok) { onUnauthorized?.(); throw new ApiError(401, 'Sesi berakhir, silakan masuk lagi'); }
    r = await raw(path, init);
  }
  const ct = r.headers.get('content-type') ?? '';
  if (r.ok && !ct.includes('application/json')) return (await r.blob()) as any;
  const data = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, data?.message ?? 'Terjadi kesalahan', data?.details);
  return data;
}
export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, body?: unknown) => api<T>(p, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) });
export const patch = <T = any>(p: string, body?: unknown) => api<T>(p, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
export const put = <T = any>(p: string, body?: unknown) => api<T>(p, { method: 'PUT', body: JSON.stringify(body ?? {}) });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });

export const can = (u: AuthUser | null, perm: string) => !!u?.perms.includes(perm);
/** 'YYYY-MM' bulan berjalan di WIB (bukan UTC: tgl 1 pukul 00.00–06.59 WIB masih bulan lalu menurut UTC) */
export const monthWIB = (d = new Date()) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 7);
/** 'YYYY-MM-DD' hari ini di WIB */
export const todayWIB = (d = new Date()) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
export const rupiah = (n: number) => 'Rp' + n.toLocaleString('id-ID');
export const tgl = (d?: string | null) => (d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
export async function download(path: string, filename: string) {
  const blob = await api<Blob>(path); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
