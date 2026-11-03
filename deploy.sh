#!/usr/bin/env bash
# RuDeFi — скрипт деплоя на VPS. Запускать на VPS'е после git pull.
#
# Переменные среды:
#   DOMAIN  — домен (обязательно, напр. rudefi.example.com)
#   EMAIL   — почта для Let's Encrypt (обязательно, только при первом запуске)
#   SKIP_CERT=1 — пропустить получение сертификата (если уже есть)

set -euo pipefail

if [ -z "${DOMAIN:-}" ]; then
  echo "FATAL: укажи DOMAIN. Пример: DOMAIN=rudefi.example.com ./deploy.sh"
  exit 1
fi
if [ -z "${EMAIL:-}" ] && [ -z "${SKIP_CERT:-}" ]; then
  echo "FATAL: укажи EMAIL для Let's Encrypt. Пример: EMAIL=you@example.com ./deploy.sh"
  exit 1
fi

echo "==> Деплой RuDeFi на $DOMAIN"

# 1. Подставляем домен в nginx-конфиг.
sed -i.bak "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" nginx/conf.d/default.conf
rm -f nginx/conf.d/default.conf.bak

# 2. Собираем образ приложения.
echo "==> docker compose build + up (app)"
DOMAIN=$DOMAIN docker compose up -d --build app

# 3. Первый раз — получаем Let's Encrypt сертификат.
if [ -z "${SKIP_CERT:-}" ]; then
  echo "==> Получаем Let's Encrypt сертификат для $DOMAIN"
  # Временный HTTP-only конфиг для ACME challenge
  cat > nginx/conf.d/_bootstrap.conf <<EOF
server {
  listen 80 default_server;
  server_name $DOMAIN;
  location /.well-known/acme-challenge/ { root /var/www/certbot; }
  location / { return 200 'certbot bootstrap'; }
}
EOF
  mv nginx/conf.d/default.conf nginx/conf.d/default.conf.disabled
  DOMAIN=$DOMAIN docker compose up -d nginx
  sleep 3

  docker compose --profile tools run --rm --entrypoint certbot certbot \
    certonly --webroot --webroot-path=/var/www/certbot \
    --email "$EMAIL" --agree-tos --no-eff-email \
    -d "$DOMAIN"

  rm -f nginx/conf.d/_bootstrap.conf
  mv nginx/conf.d/default.conf.disabled nginx/conf.d/default.conf
fi

# 4. Финальный up всех сервисов — nginx теперь с HTTPS.
echo "==> Поднимаем всё"
DOMAIN=$DOMAIN docker compose up -d
docker compose exec nginx nginx -s reload || true

echo ""
echo "✅ Готово. Открывай https://$DOMAIN"
echo ""
echo "Полезное:"
echo "  Логи:          docker compose logs -f"
echo "  Статус:        docker compose ps"
echo "  Рестарт app:   docker compose restart app"
echo "  Обновление:    git pull && SKIP_CERT=1 DOMAIN=$DOMAIN ./deploy.sh"
