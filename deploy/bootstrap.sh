#!/usr/bin/env bash
# Disiapkan sekali di VPS Ubuntu/Debian baru (dijalankan lewat `make setup`): Docker, firewall, folder.
set -euo pipefail
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | $SUDO sh
fi
$SUDO systemctl enable --now docker
[ "$(id -u)" -ne 0 ] && $SUDO usermod -aG docker "$USER" || true
if ! command -v ufw >/dev/null 2>&1; then $SUDO apt-get update -y && $SUDO apt-get install -y ufw; fi
SSH_PORT="${SSH_PORT:-22}"
$SUDO ufw allow "${SSH_PORT}/tcp"; $SUDO ufw allow 80/tcp; $SUDO ufw allow 443/tcp; $SUDO ufw allow 443/udp
$SUDO ufw --force enable
$SUDO mkdir -p /opt/rta/config /opt/rta/backups
$SUDO chown -R "$(id -un)":"$(id -gn)" /opt/rta
chmod 700 /opt/rta/config
echo "OK: Docker $(docker --version) siap. Lanjut: make config-init"
