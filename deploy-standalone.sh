#!/usr/bin/env bash
# RuDeFi — быстрый standalone деплой на VPS где уже крутятся другие приложения.
# Не ставит свой nginx и SSL — предполагается что они уже есть (или не нужны).
#
# Запускать прямо на VPS из клонированного репо.
# Default port — 8080 (localhost only). Открыть наружу — редактируй compose.

set -euo pipefail

echo "==> RuDeFi standalone deploy"

# Проверка docker
if ! command -v docker >/dev/null; then
  echo "FATAL: docker не установлен"
  echo "Поставь одной командой: curl -fsSL https://get.docker.com | sudo bash"
  exit 1
fi

# Build + up
echo "==> Собираем образ и поднимаем"
docker compose -f docker-compose.standalone.yml up -d --build

# Ждём health
echo "==> Ждём пока бэкенд поднимется"
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  if curl -sf http://127.0.0.1:8080/api/healthz >/dev/null 2>&1; then
    echo "✅ /api/healthz отвечает"
    break
  fi
  echo "   попытка $i/10..."
  if [ $i -eq 10 ]; then
    echo "⚠ бэкенд не ответил за 20с, смотри docker logs rudefi"
  fi
done

echo ""
echo "RuDeFi запущен на http://127.0.0.1:8080"
echo ""
echo "Что дальше:"
echo "  1. Проверь работу:        curl http://127.0.0.1:8080/api/healthz"
echo "  2. Добавь nginx-snippet в свою конфигурацию — см. nginx-snippet.conf"
echo "  3. Логи:                  docker logs -f rudefi"
echo "  4. Статус:                docker ps | grep rudefi"
echo "  5. Перезапуск:            docker compose -f docker-compose.standalone.yml restart"
echo "  6. Обновление:            git pull && ./deploy-standalone.sh"
