#!/usr/bin/env bash
# RuDeFi — standalone deploy. For VPS that already has other apps using
# ports 80/443 and runs its own nginx + certbot.
#
# What it does:
#   1. Pre-flight checks (docker, free port, config files)
#   2. Builds the C++ backend into a Docker image
#   3. Starts it on 127.0.0.1:8080 (loopback only, safe default)
#   4. Waits for /api/healthz
#   5. Prints what you need to do next (nginx + SSL)
#
# Run on the VPS:
#   cd ~/RuDeFi && ./deploy-standalone.sh

set -euo pipefail

C_RED='\033[0;31m'; C_GREEN='\033[0;32m'; C_YEL='\033[0;33m'; C_BLU='\033[0;34m'; C_END='\033[0m'
say()    { echo -e "${C_BLU}==>${C_END} $*"; }
ok()     { echo -e "${C_GREEN}✓${C_END} $*"; }
warn()   { echo -e "${C_YEL}⚠${C_END} $*"; }
fatal()  { echo -e "${C_RED}✗${C_END} $*" >&2; exit 1; }

say "RuDeFi standalone deploy"
echo

# --- Pre-flight ---
say "Pre-flight checks"

# Docker
if ! command -v docker >/dev/null; then
  fatal "docker is not installed. Install with: curl -fsSL https://get.docker.com | sudo bash"
fi
if ! docker info >/dev/null 2>&1; then
  fatal "docker daemon is not running or current user lacks permission. Try: sudo usermod -aG docker \$USER && newgrp docker"
fi
ok "docker available ($(docker --version | awk '{print $3}' | tr -d ,))"

# docker compose (v2 plugin)
if ! docker compose version >/dev/null 2>&1; then
  fatal "docker compose v2 plugin is missing. Modern docker ships with it — update docker."
fi
ok "docker compose available"

# Port 8080 free?
if ss -tln 2>/dev/null | awk '{print $4}' | grep -q ':8080$'; then
  warn "port 8080 is already in use on the host. Edit docker-compose.standalone.yml and change the host port."
fi

# Required files
for f in Dockerfile docker-compose.standalone.yml config/chains.json config/tokens.json ui/index.html src/server/http_server.cpp; do
  [ -f "$f" ] || fatal "missing $f — are you in the repo root?"
done
ok "repo files present"

# Disk — need at least 2 GB for the build
free_gb=$(df -BG . | awk 'NR==2 {gsub("G","",$4); print $4}')
if [ "${free_gb:-0}" -lt 2 ]; then
  warn "only ${free_gb} GB free. First build pulls ~500 MB of base images + ~30 MB C++ deps; recommend 2+ GB free."
fi

echo

# --- Build + up ---
say "Building image and starting container (first build takes 3-7 minutes)"
docker compose -f docker-compose.standalone.yml up -d --build

echo

# --- Wait for health ---
say "Waiting for /api/healthz"
HEALTH_OK=0
for i in $(seq 1 20); do
  if curl -sf http://127.0.0.1:8080/api/healthz >/dev/null 2>&1; then
    ok "backend responding"
    HEALTH_OK=1
    break
  fi
  sleep 2
  printf "   try %s/20...\r" "$i"
done
echo

if [ "$HEALTH_OK" -eq 0 ]; then
  warn "backend did not respond within 40s. Inspect logs:"
  echo "    docker logs rudefi --tail 50"
  exit 1
fi

# --- Done ---
echo
ok "RuDeFi is running on http://127.0.0.1:8080"
echo
echo "Next steps:"
echo "  1. Verify API:         curl http://127.0.0.1:8080/api/healthz"
echo "  2. Expose via nginx:   use nginx-snippet.conf as a template"
echo "                         (sudo cp nginx-snippet.conf /etc/nginx/sites-available/rudefi)"
echo "  3. Get SSL cert:       sudo certbot --nginx -d rudefi.your-domain.ru"
echo "  4. Follow logs:        docker logs -f rudefi"
echo "  5. Future updates:     ./update.sh"
echo
echo "See DEPLOY.md for the full walkthrough."
