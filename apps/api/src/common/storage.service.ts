import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, normalize } from 'path';
import { randomBytes } from 'crypto';

/**
 * Penyimpanan file bukti pembayaran. Implementasi saat ini: disk lokal (STORAGE_DIR).
 * Antarmuka sengaja kecil (put/get) agar mudah diganti adapter Supabase Storage / S3 / R2.
 * File tidak pernah dilayani langsung; selalu lewat endpoint yang memeriksa hak akses.
 */
@Injectable()
export class StorageService {
  private root = process.env.STORAGE_DIR ?? join(process.cwd(), 'storage');
  async put(prefix: string, data: Buffer, ext: string) {
    const key = `${prefix}/${new Date().toISOString().slice(0, 7)}/${randomBytes(12).toString('hex')}.${ext}`;
    const path = join(this.root, key);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, data);
    return key;
  }
  async get(key: string) {
    const path = normalize(join(this.root, key));
    if (!path.startsWith(normalize(this.root))) throw new Error('Path tidak valid');
    return readFile(path);
  }
}

/** Periksa jenis file dari isinya (bukan ekstensi). */
export function sniffImage(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  if (buf.subarray(0, 5).toString() === '%PDF-') return { ext: 'pdf', mime: 'application/pdf' };
  return null;
}
