# API di runtime Bun. Build: docker build -t rta-api apps/api  (jalankan dari root repo: docker build -f apps/api/Dockerfile .)
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock* ./
COPY apps/api/package.json apps/api/
RUN bun install --frozen-lockfile --production --filter rta-api
COPY apps/api apps/api
WORKDIR /app/apps/api
ENV NODE_ENV=production
# Bukti pembayaran: pasang volume ke folder ini (lihat docs/SETUP.md)
ENV STORAGE_DIR=/data/storage
RUN mkdir -p /data/storage
EXPOSE 3000
# Start: migrasi → seed data master (idempotent; menyisipkan izin baru) → API. Folder dev/ & test/ tidak ikut image (.dockerignore).
CMD ["sh", "-c", "bun scripts/migrate.ts && bun src/db/seed.ts && bun src/main.ts"]
