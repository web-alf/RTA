import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

/**
 * TRUST_PROXY → setelan Express `trust proxy`: dari mana IP asli pengunjung dibaca (batas login per IP, audit, daftar perangkat).
 * - kosong: 'loopback' (hanya proxy di mesin yang sama dipercaya)
 * - angka (mis. 1): jumlah proxy di depan API (Caddy/nginx/cPanel). Paling aman di produksi; IP = alamat yang ditambahkan proxy terdekat.
 * - 'true' / 'false', atau daftar alamat/subnet ('loopback, uniquelocal').
 */
function trustProxy(v = process.env.TRUST_PROXY?.trim()): boolean | number | string {
  if (!v) return 'loopback';
  if (v === 'true' || v === 'false') return v === 'true';
  return /^\d+$/.test(v) ? Number(v) : v;
}

/**
 * BASE_PATH → awalan URL seluruh rute API, mis. "/api". Isi HANYA bila hosting meneruskan alamat lengkap ke API tanpa membuang
 * awalan (cPanel "Setup Node.js App" dengan Application URL "domain/api"). Kosong (bawaan, Docker/VPS/lokal): rute tanpa awalan,
 * dan proxy (Vite/Caddy/nginx) yang membuang "/api".
 */
function basePath(v = process.env.BASE_PATH?.trim()): string {
  return (v ?? '').replace(/^\/+|\/+$/g, '');
}

async function bootstrap() {
  for (const k of ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) if (!process.env[k]) throw new Error(`Env ${k} belum diisi (lihat .env.example)`);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] });
  app.set('trust proxy', trustProxy());
  if (basePath()) app.setGlobalPrefix(basePath());
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: (process.env.WEB_ORIGIN ?? 'http://localhost:5173').split(','), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`RTA API berjalan di http://localhost:${port}`);
}
bootstrap();
