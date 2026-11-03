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

C_GREEN='\033[0;32m'; C_YEL='\033[0;33m'; C_RED='\033[0;31m'; C_BLU='\033[0;34m'; C_END='\033[0m'
say()   { echo -e "${C_BLU}==>${C_END} $*"; }
ok()    { echo -e "${C_GREEN}✓${C_END} $*"; }
warn()  { echo -e "${C_YEL}⚠${C_END} $*"; }
fatal() { echo -e "${C_RED}✗${C_END} $*" >&2; exit 1; }

[ -d .git ] || fatal "not a git checkout — run from the RuDeFi repo root"

# Which compose file is active?
if docker ps --format '{{.Names}}' | grep -q '^rudefi-nginx$'; then
  COMPOSE_FILE="docker-compose.yml"
  say "detected full-stack deployment"
elif docker ps --format '{{.Names}}' | grep -q '^rudefi$'; then
  COMPOSE_FILE="docker-compose.standalone.yml"
  say "detected standalone deployment"
else
  fatal "no running rudefi container found. Use deploy-standalone.sh (or deploy.sh) first."
fi

CURRENT=$(git rev-parse --short HEAD)
say "current commit: $CURRENT"

say "fetching remote"
git fetch --quiet

NEW=$(git rev-parse --short @{u} 2>/dev/null || echo "")
if [ "$NEW" = "$CURRENT" ]; then
  ok "already up to date — nothing to do"
  exit 0
fi

say "pulling (fast-forward only)"
git pull --ff-only || fatal "fast-forward failed. Resolve local changes manually: git status"

ok "updated $CURRENT → $NEW"

say "rebuilding image"
docker compose -f "$COMPOSE_FILE" up -d --build

say "waiting for /api/healthz"
HEALTHY=0
for i in $(seq 1 30); do
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

ok "update complete"
echo
echo "Changelog:"
git log --oneline "$CURRENT..$NEW" | head -10
