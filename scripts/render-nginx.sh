#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DOMAIN="${DOMAIN:-$(cat .rudefi-domain 2>/dev/null || true)}"
[[ "$DOMAIN" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$ ]] || {
  echo 'Set DOMAIN to the hostname used by your existing certificate' >&2
  exit 1
}
mkdir -p infra/nginx/conf.d
sed "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" infra/nginx/templates/default.conf.template > infra/nginx/conf.d/default.conf
printf '%s\n' "$DOMAIN" > .rudefi-domain
