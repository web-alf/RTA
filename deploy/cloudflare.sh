#!/usr/bin/env bash
# Cloudflare API: dns | ssl | purge | ips      Butuh: curl, jq. Variabel dari deploy.local.env (lewat Makefile).
set -euo pipefail
API=https://api.cloudflare.com/client/v4
need() { for v in "$@"; do [ -n "${!v:-}" ] || { echo "Variabel $v belum diisi di deploy/deploy.local.env" >&2; exit 1; }; done; }
cf() { # cf METHOD PATH [JSON]
  local out; out=$(curl -sS -X "$1" "$API$2" -H "Authorization: Bearer $CF_API_TOKEN" -H 'Content-Type: application/json' ${3:+--data "$3"})
  echo "$out" | jq -e '.success' >/dev/null || { echo "Cloudflare menolak: $(echo "$out" | jq -c '.errors')" >&2; exit 1; }
  echo "$out"
}
case "${1:-}" in
  dns)
    need CF_API_TOKEN CF_ZONE_ID DOMAIN VPS_IP
    body=$(jq -nc --arg n "$DOMAIN" --arg c "$VPS_IP" --argjson p "${CF_PROXIED:-true}" '{type:"A",name:$n,content:$c,ttl:1,proxied:$p,comment:"RTA dashboard (make dns)"}')
    id=$(cf GET "/zones/$CF_ZONE_ID/dns_records?type=A&name=$DOMAIN" | jq -r '.result[0].id // empty')
    if [ -n "$id" ]; then cf PUT "/zones/$CF_ZONE_ID/dns_records/$id" "$body" >/dev/null; echo "DNS diperbarui: $DOMAIN → $VPS_IP (proxied=${CF_PROXIED:-true})"
    else cf POST "/zones/$CF_ZONE_ID/dns_records" "$body" >/dev/null; echo "DNS dibuat: $DOMAIN → $VPS_IP (proxied=${CF_PROXIED:-true})"; fi ;;
  ssl)
    need CF_API_TOKEN CF_ZONE_ID
    cf PATCH "/zones/$CF_ZONE_ID/settings/ssl" '{"value":"strict"}' >/dev/null && echo "SSL/TLS mode: Full (strict)"
    cf PATCH "/zones/$CF_ZONE_ID/settings/always_use_https" '{"value":"on"}' >/dev/null && echo "Always Use HTTPS: on"
    cf PATCH "/zones/$CF_ZONE_ID/settings/min_tls_version" '{"value":"1.2"}' >/dev/null && echo "TLS minimum: 1.2" ;;
  purge)
    need CF_API_TOKEN CF_ZONE_ID
    cf POST "/zones/$CF_ZONE_ID/purge_cache" '{"purge_everything":true}' >/dev/null && echo "Cache Cloudflare dibersihkan" ;;
  ips) # IP Cloudflare, dipisah spasi (untuk Caddy trusted_proxies)
    { curl -fsS https://www.cloudflare.com/ips-v4; echo; curl -fsS https://www.cloudflare.com/ips-v6; } | tr '\n' ' ' | sed 's/  */ /g;s/ $//' ;;
  *) echo "pakai: $0 dns|ssl|purge|ips" >&2; exit 1 ;;
esac
