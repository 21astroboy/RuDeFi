#!/usr/bin/env bash
# RuDeFi — update to the latest version from git.
#
# What it does:
#   1. git pull (fast-forward only — won't clobber local changes)
#   2. Rebuilds the Docker image if source changed
#   3. Restarts the container
#   4. Verifies /api/healthz
#
# Run on the VPS:
#   cd ~/RuDeFi && ./update.sh

set -euo pipefail
cd "$(dirname "$0")/.."

C_GREEN='\033[0;32m'; C_YEL='\033[0;33m'; C_RED='\033[0;31m'; C_BLU='\033[0;34m'; C_END='\033[0m'
say()   { echo -e "${C_BLU}==>${C_END} $*"; }
ok()    { echo -e "${C_GREEN}✓${C_END} $*"; }
warn()  { echo -e "${C_YEL}⚠${C_END} $*"; }
fatal() { echo -e "${C_RED}✗${C_END} $*" >&2; exit 1; }

[ -d .git ] || fatal "not a git checkout — run from the RuDeFi repo root"

# Which compose file is active?
if docker ps --format '{{.Names}}' | grep -q '^rudefi-nginx$'; then
  COMPOSE_FILE="infra/docker/docker-compose.yml"
  say "detected full-stack deployment"
elif docker ps --format '{{.Names}}' | grep -q '^rudefi$'; then
  COMPOSE_FILE="infra/docker/docker-compose.standalone.yml"
  say "detected standalone deployment"
else
  fatal "no running rudefi container found. Use deploy-standalone.sh (or deploy.sh) first."
fi

CURRENT=$(git rev-parse --short HEAD)
say "current commit: $CURRENT"

if [ -n "${RUDEFI_VERIFIED_SHA:-}" ]; then
  [[ "$RUDEFI_VERIFIED_SHA" =~ ^[0-9a-f]{40}$ ]] || fatal "invalid verified SHA"
  [ "$(git rev-parse HEAD)" = "$RUDEFI_VERIFIED_SHA" ] || fatal "checkout differs from verified SHA"
  NEW=$(git rev-parse --short HEAD)
else
  say "fetching remote"
  git fetch --quiet origin main
  NEW=$(git rev-parse --short origin/main)
  say "pulling (fast-forward only)"
  git merge --ff-only origin/main || fatal "fast-forward failed; inspect git status"
fi

ok "updated $CURRENT → $NEW"

if [ "$COMPOSE_FILE" = "infra/docker/docker-compose.yml" ]; then
  bash scripts/render-nginx.sh
fi

say "rebuilding image"
docker compose -f "$COMPOSE_FILE" up -d --build

say "waiting for /api/healthz"
HEALTHY=0
for ((attempt=0; attempt<30; attempt++)); do
  if docker compose -f "$COMPOSE_FILE" exec -T app curl -fsS --max-time 5 \
      "http://127.0.0.1:8787/api/healthz" >/dev/null 2>&1; then
    HEALTHY=1
    ok "backend responding on 8787 inside app container"
    break
  fi
  sleep 2
done
if [ "$HEALTHY" -ne 1 ]; then
  docker compose -f "$COMPOSE_FILE" logs --tail=50 app
  fatal "backend health check failed — update is not healthy"
fi

# Docker DNS resolves app once when nginx starts: reload after recreation.
if [ "$COMPOSE_FILE" = "infra/docker/docker-compose.yml" ]; then
  docker compose -f "$COMPOSE_FILE" exec -T nginx nginx -t
  docker compose -f "$COMPOSE_FILE" exec -T nginx nginx -s reload
fi
git rev-parse HEAD > .rudefi-deployed
ok "update complete"
echo
echo "Changelog:"
git log --oneline "$CURRENT..$NEW" | head -10
