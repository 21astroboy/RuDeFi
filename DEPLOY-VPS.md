# RuDeFi — деплой на свой VPS

Два сценария — выбирай по ситуации.

## ⚡ Standalone — VPS уже с другими приложениями (nginx, порты 80/443 заняты)

Разворачиваем только C++ бэкенд на локальном порту 8080, твой существующий nginx проксирует к нему отдельным server-блоком. Не ломает существующие проекты.

```bash
ssh algoclimb         # твой SSH-алиас
cd ~
git clone https://github.com/21astroboy/RuDeFi.git
cd RuDeFi
./deploy-standalone.sh
```

Через 5-10 минут (первый build медленный — FetchContent качает ~30 МБ зависимостей) должен ответить `curl http://127.0.0.1:8080/api/healthz`.

### После успешного запуска — настройка nginx

Если хочешь на поддомене `rudefi.твой-домен` c HTTPS:

```bash
# 1. Добавь в DNS A-запись: rudefi.домен → 2.27.41.60
# 2. Подложи server-блок:
sudo cp nginx-snippet.conf /etc/nginx/sites-available/rudefi
sudo sed -i 's/SERVER_NAME_HERE/rudefi.твой-домен.ру/' /etc/nginx/sites-available/rudefi
sudo ln -s /etc/nginx/sites-available/rudefi /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 3. SSL от Let's Encrypt (certbot у тебя уже стоит):
sudo certbot --nginx -d rudefi.твой-домен.ру
```

Готово — `https://rudefi.твой-домен` работает, PWA устанавливается на мобилу, остальные приложения не затронуты.

**Обновление:**
```bash
ssh algoclimb && cd ~/RuDeFi && git pull && ./deploy-standalone.sh
```

---

## 🚀 Полный стек — на чистый VPS (свой nginx+certbot в докере)

Если на VPS больше ничего нет — ставь полный стек с собственным nginx+certbot. Инструкция ниже.

Если у тебя ещё нет VPS — рекомендую **Hetzner CX22** (~€4/мес, 2 vCPU, 4 ГБ RAM, Ubuntu 22.04) или **DigitalOcean Basic** ($6/мес). Проект легко укладывается в 1 ГБ RAM.

---

## Что надо иметь перед стартом

1. **VPS с Ubuntu 22.04+** и root/sudo доступом по SSH
2. **Домен** (Namecheap, Reg.ru, Cloudflare Registrar) — ~$10/год
3. **A-запись в DNS** указывающая на IP твоего VPS. Например:
   ```
   Type: A
   Name: rudefi
   Value: 123.45.67.89   (IP твоего VPS)
   TTL:  600
   ```
   Подожди 5-30 минут пока DNS пропагируется (`dig rudefi.твой.ру` должен вернуть IP).
4. **Email** для Let's Encrypt уведомлений

---

## Шаг 1 — Подключаемся к VPS

```bash
ssh root@твой_vps_ip
```

Если первый раз на этом VPS — создай обычного пользователя (небезопасно работать из-под root):

```bash
adduser kirill
usermod -aG sudo kirill
mkdir -p /home/kirill/.ssh
cp ~/.ssh/authorized_keys /home/kirill/.ssh/
chown -R kirill:kirill /home/kirill/.ssh
chmod 700 /home/kirill/.ssh
chmod 600 /home/kirill/.ssh/authorized_keys
# Отключи вход по root:
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh
# Выйти и залогиниться как kirill:
exit
ssh kirill@твой_vps_ip
```

---

## Шаг 2 — Ставим Docker

Одной командой (официальный скрипт):

```bash
curl -fsSL https://get.docker.com | sudo bash
sudo usermod -aG docker $USER
# Выйти и зайти заново чтобы group применилась:
exit
ssh kirill@твой_vps_ip
# Проверка:
docker version
docker compose version
```

Должно вывести версии без ошибок. Compose plugin v2 идёт встроенным, отдельно ставить не надо.

---

## Шаг 3 — Клонируем RuDeFi

```bash
cd ~
git clone https://github.com/21astroboy/RuDeFi.git
cd RuDeFi
ls -la
```

Должны быть видны `docker-compose.yml`, `Dockerfile`, `deploy.sh`, `nginx/`, `ui/`, `src/`, etc.

---

## Шаг 4 — (Опционально) добавляем Alchemy API key

Для стабильности RPC-ответов. Без ключа будут работать публичные RPC — реже отваливаются, но медленнее.

```bash
cp config/settings.example.json config/settings.json
nano config/settings.json
```

Вставь свой `alchemy_api_key` из `https://dashboard.alchemy.com`. Остальное можно не трогать.

---

## Шаг 5 — Разрешаем порты в firewall

Если на VPS включён `ufw` (Ubuntu) или `firewalld`:

```bash
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP (нужен для Let's Encrypt validation)
sudo ufw allow 443/tcp    # HTTPS
sudo ufw enable
sudo ufw status
```

На Hetzner / DigitalOcean проверь ещё и Cloud Firewall в веб-панели — там тоже надо открыть 80/443.

---

## Шаг 6 — Деплой!

Одна команда делает всё: собирает Docker-образ, запускает контейнеры, получает Let's Encrypt сертификат.

```bash
DOMAIN=rudefi.твой-домен.ру EMAIL=you@gmail.com ./deploy.sh
```

Что произойдёт:
1. Build образа C++ приложения (3-7 минут первый раз — качает nlohmann/json, cli11, cpp-httplib через FetchContent)
2. Запуск контейнера `rudefi-app` на внутреннем порту 8787
3. Запуск `rudefi-nginx` на 80/443
4. Certbot запрашивает SSL-сертификат через Let's Encrypt webroot challenge
5. Nginx перегружается с HTTPS
6. ✅ Готово

В случае успеха внизу увидишь:
```
✅ Готово. Открывай https://rudefi.твой-домен.ру
```

Открывай URL в браузере — должен загрузиться RuDeFi с замочком SSL.

---

## Шаг 7 — Автообновление SSL (раз в 90 дней)

Let's Encrypt сертификаты живут 90 дней. Добавь cron:

```bash
sudo crontab -e
```

Добавь строку:
```cron
0 3 * * 0 cd /home/kirill/RuDeFi && docker compose run --rm --entrypoint certbot certbot renew && docker compose exec nginx nginx -s reload
```

Это каждое воскресенье в 3:00 будет пытаться обновить cert. Certbot ничего не делает если cert ещё валиден > 30 дней.

---

## Шаг 8 — Мобильный доступ (PWA установка)

### На iPhone (Safari)

1. Открой `https://rudefi.твой-домен.ру` в Safari
2. Жми **кнопку Share** внизу (квадратик со стрелкой вверх)
3. Прокрути вниз → **Add to Home Screen** / **На экран «Домой»**
4. Иконка RuDeFi появится как обычное приложение
5. При запуске — fullscreen без адресной строки

### На Android (Chrome)

1. Открой URL в Chrome
2. В меню (три точки) → **Install app** / **Установить приложение**
3. Либо снизу страницы появится баннер «Add to Home Screen»

### MetaMask на мобиле

- **Safari + iPhone**: внутри Safari MetaMask не работает. Используй **MetaMask Mobile App** → во встроенном браузере введи URL `https://rudefi.твой-домен.ру`
- **Chrome + Android**: открывай сначала **MetaMask Mobile App**, потом в его встроенном браузере вводи URL

Внутри MetaMask-браузера connect через `window.ethereum` работает автоматически.

---

## Обновление RuDeFi (когда выйдет новая версия)

```bash
ssh kirill@твой_vps_ip
cd ~/RuDeFi
git pull
SKIP_CERT=1 DOMAIN=rudefi.твой-домен.ру ./deploy.sh
```

`SKIP_CERT=1` пропускает получение сертификата (у тебя он уже есть). Build + up займёт 1-3 минуты (Docker-кэш работает).

---

## Диагностика

### Сайт не открывается / 502 Bad Gateway

```bash
docker compose ps                    # все ли контейнеры Running
docker compose logs app              # что говорит бэкенд
docker compose logs nginx            # что говорит прокси
docker compose exec app curl 127.0.0.1:8787/api/healthz   # внутренний чек
```

### Let's Encrypt failed

Самые частые причины:
- DNS A-запись не обновилась → `dig rudefi.домен.ру` возвращает другой IP
- Порт 80 закрыт firewall'ом
- Домен уже засветился в rate-limit (5 запросов в неделю на домен)

Проверь:
```bash
curl -I http://rudefi.твой.ру/.well-known/acme-challenge/test
# должен вернуть 404, но от nginx — значит порт 80 работает
```

### Контейнер app падает в restart loop

```bash
docker compose logs -f app
```

Обычно это:
- Нехватка RAM (на 1 ГБ VPS build может OOM — попробуй сначала собрать локально + push to GHCR)
- Отсутствует `config/chains.json` или `config/tokens.json` (но они в репо, странно)

### Хочу посмотреть, что ест ресурсы

```bash
docker stats
```

Нормальные показатели:
- `app`: 50-150 МБ RAM, <1% CPU в idle
- `nginx`: 5-20 МБ RAM, ~0% CPU

---

## Дешёвые опции улучшения

1. **Cloudflare перед доменом** (бесплатно) — DDoS защита + CDN. Включи «Full (strict)» SSL mode после установки.
2. **Fail2ban** — автобан IP пытающихся брутфорсить SSH:
   ```bash
   sudo apt install fail2ban
   sudo systemctl enable --now fail2ban
   ```
3. **Автоматические security updates**:
   ```bash
   sudo apt install unattended-upgrades
   sudo dpkg-reconfigure --priority=low unattended-upgrades
   ```
4. **Backup `config/settings.json`** на свой компьютер — ключи там, восстановишь если VPS сдохнет.

---

## Чек-лист после деплоя

- [ ] `https://rudefi.твой-домен.ру` открывается с замочком SSL
- [ ] Подключение MetaMask работает (desktop)
- [ ] На iPhone/Android добавил через «На экран Домой»
- [ ] Из MetaMask Mobile Browser портфель сканируется
- [ ] `docker compose ps` показывает все контейнеры `Up (healthy)`
- [ ] Cron для renew SSL добавлен
- [ ] Firewall `ufw status` → только 22/80/443 открыты
- [ ] `./deploy.sh` можно запустить ещё раз с SKIP_CERT=1 без ошибок

Если всё отмечено — работает идеально. Можно делиться линком.
