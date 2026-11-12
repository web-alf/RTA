import { randomBytes } from 'crypto';
import { argon2id, argon2Verify } from 'hash-wasm';

/**
 * Hash password argon2id. Berjalan di Bun maupun Node (WASM, tanpa modul native), jadi API bisa di-deploy
 * ke hosting Node (mis. cPanel "Setup Node.js App"). Jangan pakai `Bun.password` di src/ atau scripts/.
 *
 * Parameter sama dengan bawaan `Bun.password` (m=65536 KiB, t=2, p=1, salt & hash 32 byte) sehingga hash
 * yang sudah tersimpan di database tetap bisa diverifikasi, dan hash baru setara kekuatannya.
 */
export function hashPassword(password: string): Promise<string> {
  return argon2id({ password, salt: randomBytes(32), parallelism: 1, iterations: 2, memorySize: 65536, hashLength: 32, outputType: 'encoded' });
}

/** false untuk hash yang kosong/rusak/bukan argon2 (akun terhapus memakai hash acak yang tetap valid formatnya). */
export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash || !hash.startsWith('$argon2')) return false;
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
}
