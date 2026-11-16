#!/usr/bin/env bash
# Membuat /opt/rta/config/{compose.env,api.env} di VPS bila belum ada (rahasia dibuat acak). Tidak menimpa file yang sudah ada.
# Dijalankan di server lewat `make config-init` dengan variabel DOMAIN.
set -euo pipefail
: "${DOMAIN:?DOMAIN kosong}"
C=/opt/rta/config
PGPW=$(openssl rand -hex 24)
if [ ! -f "$C/compose.env" ]; then
  umask 077
  printf 'DOMAIN=%s\nPOSTGRES_PASSWORD=%s\n' "$DOMAIN" "$PGPW" > "$C/compose.env"
  echo "dibuat: compose.env"
else echo "sudah ada: compose.env (tidak diubah)"; fi
if [ ! -f "$C/api.env" ]; then
  umask 077
  cat > "$C/api.env" <<ENV
# DATABASE_URL, STORAGE_DIR, BASE_PATH, NODE_ENV diisi oleh docker-compose.prod.yml. Sisanya di sini.
JWT_ACCESS_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
ACCESS_TTL=15m
REFRESH_TTL_DAYS=14
WEB_ORIGIN=https://$DOMAIN
PUBLIC_WEB_URL=https://$DOMAIN
COOKIE_SECURE=true
PORT=3000
# Cloudflare → Caddy → API: Caddy sudah menaruh IP pengunjung asli di X-Forwarded-For, jadi 1 proxy.
TRUST_PROXY=1
DISABLE_SCHEDULER=false
# Nilai AWAL saja; setelah PJ menyimpan di menu Pengaturan, nilai di database yang dipakai.
BANK_NAME=Bank Syariah Indonesia
BANK_ACCOUNT=ISI-NOMOR-REKENING
BANK_HOLDER=Yayasan Al-Fatihah
REREGISTRATION_FEE=100000
ACADEMIC_YEAR_START_MONTH=7
ENV
  echo "dibuat: api.env (periksa BANK_* lewat: make config-edit)"
else echo "sudah ada: api.env (tidak diubah)"; fi
