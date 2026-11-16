# Deploy Dashboard RTA ke VPS (Docker + Caddy) dengan domain di Cloudflare.
# Dijalankan dari laptop; perintah dikirim ke VPS lewat SSH. Mulai: `make help`.
# Butuh di laptop: make, git, ssh, curl, jq (Windows: pakai Git Bash/WSL, `choco install make jq`).

-include deploy/deploy.local.env
export

VPS_USER ?= root
VPS_PORT ?= 22
VPS_IP   ?= $(VPS_HOST)
CF_PROXIED ?= true

APP_DIR := /opt/rta
SSH     := ssh -p $(VPS_PORT) $(VPS_USER)@$(VPS_HOST)
SSHT    := ssh -t -p $(VPS_PORT) $(VPS_USER)@$(VPS_HOST)
DC      := docker compose -p rta --env-file $(APP_DIR)/config/compose.env -f $(APP_DIR)/app/deploy/docker-compose.prod.yml
S       ?=

.DEFAULT_GOAL := help
.PHONY: help check-env first-deploy setup config-init config-edit config-api deploy dns ssl cf-ips purge \
        up down restart ps logs shell psql admin backup check ssh

help: ## Daftar perintah
	@echo "Dashboard RTA - deploy VPS + Cloudflare"; echo
	@echo "Pertama kali:  cp deploy/deploy.example.env deploy/deploy.local.env  (isi) -> make first-deploy -> make admin"; echo
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-13s %s\n", $$1, $$2}'

check-env:
	@for v in VPS_HOST DOMAIN; do [ -n "$${!v}" ] || { echo "Isi $$v di deploy/deploy.local.env"; exit 1; }; done

first-deploy: setup config-init dns ssl deploy cf-ips check ## Semua langkah awal: server, config, DNS, SSL, deploy

setup: check-env ## Siapkan VPS baru: Docker, firewall (22/80/443), folder
	$(SSH) 'SSH_PORT=$(VPS_PORT) bash -s' < deploy/bootstrap.sh

config-init: check-env ## Buat config rahasia di VPS (acak; tidak menimpa yang ada)
	$(SSH) 'DOMAIN=$(DOMAIN) bash -s' < deploy/init-config.sh

config-edit: check-env ## Edit config compose (DOMAIN, password DB) di VPS
	$(SSHT) 'nano $(APP_DIR)/config/compose.env'

config-api: check-env ## Edit config API (rekening, rahasia JWT, dll) lalu restart API
	$(SSHT) 'nano $(APP_DIR)/config/api.env'
	$(SSH) '$(DC) up -d api'

deploy: check-env ## Kirim commit terakhir (git HEAD) ke VPS, build, jalankan ulang
	@[ -z "$$(git status --porcelain)" ] || echo ">> PERINGATAN: ada perubahan yang belum di-commit; yang dikirim hanya isi commit terakhir (HEAD)."
	git archive --format=tar.gz HEAD | $(SSH) 'set -e; rm -rf $(APP_DIR)/app.new $(APP_DIR)/app.old; mkdir -p $(APP_DIR)/app.new; tar xz -C $(APP_DIR)/app.new; mv $(APP_DIR)/app $(APP_DIR)/app.old 2>/dev/null || true; mv $(APP_DIR)/app.new $(APP_DIR)/app'
	$(SSH) '$(DC) up -d --build --remove-orphans && docker image prune -f >/dev/null'
	@echo "Selesai. Folder rilis lama ada di $(APP_DIR)/app.old (rollback cepat); migrasi + seed jalan otomatis saat API start (make logs S=api)."

dns: ## Cloudflare: buat/perbarui record A DOMAIN -> VPS_IP
	@bash deploy/cloudflare.sh dns

ssl: ## Cloudflare: SSL Full (strict), Always HTTPS, TLS min 1.2
	@bash deploy/cloudflare.sh ssl

cf-ips: check-env ## Perbarui daftar IP Cloudflare di VPS (IP asli pengunjung untuk batas login & audit)
	@IPS="$$(bash deploy/cloudflare.sh ips)"; [ -n "$$IPS" ] || { echo "Gagal mengambil IP Cloudflare"; exit 1; }; \
	$(SSH) "cd $(APP_DIR)/config && grep -v '^CF_TRUSTED_PROXIES=' compose.env > compose.env.tmp; echo 'CF_TRUSTED_PROXIES=\"$$IPS\"' >> compose.env.tmp; mv compose.env.tmp compose.env; chmod 600 compose.env"
	$(SSH) '$(DC) up -d web'

purge: ## Cloudflare: bersihkan cache
	@bash deploy/cloudflare.sh purge

up: ## Jalankan semua layanan
	$(SSH) '$(DC) up -d'

down: ## Hentikan layanan (data/volume tetap aman)
	$(SSH) '$(DC) down'

restart: ## Restart layanan (S=api|web|db, kosong = semua)
	$(SSH) '$(DC) restart $(S)'

ps: ## Status container
	$(SSH) '$(DC) ps'

logs: ## Log (S=api|web|db, kosong = semua)
	$(SSHT) '$(DC) logs -f --tail=100 $(S)'

shell: ## Shell di container API
	$(SSHT) '$(DC) exec api sh'

psql: ## Konsol PostgreSQL
	$(SSHT) '$(DC) exec db psql -U rta rta'

admin: check-env ## Buat akun PJ pertama (tanya nama, email, password)
	@read -p "Nama PJ: " n; read -p "Email PJ: " e; read -s -p "Password (min 8): " p; echo; \
	printf '%s\n%s\n%s\n' "$$n" "$$e" "$$p" | $(SSH) 'IFS= read -r n; IFS= read -r e; IFS= read -r p; $(DC) exec -T -e ADMIN_NAME="$$n" -e ADMIN_EMAIL="$$e" -e ADMIN_PASSWORD="$$p" api bun scripts/create-admin.ts'

backup: check-env ## Unduh backup database + bukti bayar ke ./backups/ (data pribadi: simpan aman)
	@mkdir -p backups; ts=$$(date +%Y%m%d-%H%M%S); \
	$(SSH) '$(DC) exec -T db pg_dump -U rta --clean --if-exists rta | gzip' > backups/rta-db-$$ts.sql.gz && \
	$(SSH) '$(DC) exec -T api tar czf - -C /data/storage .' > backups/rta-storage-$$ts.tar.gz && \
	echo "Backup: backups/rta-db-$$ts.sql.gz, backups/rta-storage-$$ts.tar.gz"

check: check-env ## Uji: web & API menjawab lewat HTTPS
	@printf 'Web  https://$(DOMAIN)/            -> '; curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 https://$(DOMAIN)/
	@printf 'API  https://$(DOMAIN)/api/auth/me -> '; curl -s -o /dev/null -w '%{http_code} (401 = API hidup, belum login)\n' --max-time 20 https://$(DOMAIN)/api/auth/me

ssh: ## Masuk ke VPS
	$(SSHT)
