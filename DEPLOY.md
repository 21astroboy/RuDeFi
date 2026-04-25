# Деплой на Render — пошагово

Это самый простой бесплатный способ. На выходе у тебя будет публичный URL вида `https://defi-dashboard-xxxx.onrender.com`, доступный с любого устройства.

Время: **~15 минут** для полностью свежего аккаунта, **~5 минут** если у тебя уже есть GitHub.

---

## Что нужно перед стартом

- Аккаунт GitHub (если нет — `https://github.com/signup`, 1 минута)
- Аккаунт Render (`https://render.com`, login через GitHub)
- Установленный `git` на твоём ноуте — проверь: `git --version`. Если нет, на Mac: `brew install git`. Windows: скачать с git-scm.com.

Кошелька, MetaMask и приватников **не нужно** — это публичная read-only витрина.

---

## Шаг 1 — Создать GitHub-репозиторий

1. Открой `https://github.com/new`
2. Repository name: например, `defi-dashboard` (любое имя)
3. **Public** или **Private** — оба ок (Render умеет читать оба)
4. **Не ставь** галки `Add a README` / `Add .gitignore` — у нас уже есть свои
5. Жми **Create repository**

GitHub покажет инструкции «push an existing repository». Скопируй URL вида `https://github.com/USERNAME/defi-dashboard.git`.

---

## Шаг 2 — Залить код в GitHub

В терминале:

```bash
cd /Users/kirill/Desktop/crypto-app/public-app
git init
git add .
git commit -m "initial: DeFi dashboard public version"
git branch -M main
git remote add origin https://github.com/USERNAME/defi-dashboard.git
git push -u origin main
```

(Замени `USERNAME` на свой никнейм в GitHub.)

При первом push GitHub попросит залогиниться. Если выскочит ошибка `support for password authentication was removed`, то:
- Зайди на `https://github.com/settings/tokens` → **Generate new token (classic)**
- Поставь expiration «No expiration», поставь scope `repo`
- Скопируй токен и используй его как пароль при push

После успеха увидишь свои файлы на странице репозитория в браузере.

---

## Шаг 3 — Зарегистрироваться на Render

1. Открой `https://render.com`
2. Жми **Get Started → Sign in with GitHub**
3. Авторизуй Render-приложение в GitHub (нужно дать доступ к репозиториям)

Никакой кредитки на free-плане **не требуется**.

---

## Шаг 4 — Создать сервис через Blueprint

Это самый удобный путь — Render прочитает `render.yaml` из твоего репо и сам всё настроит.

1. В Render Dashboard жми **New +** в правом верхнем углу → **Blueprint**
2. **Connect a repository** → найди `defi-dashboard` в списке → **Connect**
3. Render покажет план: «Will create 1 service: `defi-dashboard` (Web Service, Docker)». Регион должен быть **Frankfurt** (как указано в render.yaml).
4. Жми **Apply**

Render начнёт сборку. На вкладке Logs увидишь:
```
==> Cloning from https://github.com/USERNAME/defi-dashboard
==> Building with Dockerfile
Step 1/15 : FROM ubuntu:22.04 AS builder
...
[100%] Built target cryptoapp
==> Deploying...
==> Your service is live at https://defi-dashboard-xxxx.onrender.com
```

**Сборка занимает 5-7 минут.** В первую сборку cmake скачивает зависимости (nlohmann/json, CLI11, cpp-httplib через FetchContent) — это медленно один раз, дальше Docker layer кэшируется.

---

## Шаг 5 — Проверить что работает

Открой выданный URL в браузере. Должна загрузиться вкладка **Холдинги** с полем для ввода адреса.

Тест:
- Введи любой публичный адрес (например, `0x28C6c06298d514Db089934071355E5743bf21d60` — Binance hot wallet) → жми **Сканировать**
- Через 3-5 секунд увидишь список балансов по 11 сетям

Если что-то не работает:
- Открой `https://your-url.onrender.com/api/healthz` — должен вернуть `{"ok":true}`
- На странице Render твоего сервиса → вкладка **Logs** — посмотри последние 50 строк, ищи errors

---

## Шаг 6 — Не дать сервису засыпать (важно!)

На free-плане Render **усыпляет** сервис после 15 минут без запросов. Первый запрос после сна занимает 30-60 секунд (cold start).

Чтобы избежать этого — сделай keep-alive ping каждые 10 минут через бесплатный `cron-job.org`:

1. Зарегистрируйся на `https://cron-job.org` (бесплатно)
2. **Cronjobs → Create cronjob**
3. Title: `keep-alive defi-dashboard`
4. URL: `https://defi-dashboard-xxxx.onrender.com/api/healthz`
5. Schedule: **Every 10 minutes** (`*/10 * * * *`)
6. **Create**

Готово. Теперь Render будет считать сервис активным 24/7. Free-план даёт 750 часов/мес — этого хватает на полноценный uptime одного сервиса.

Альтернатива — `https://uptimerobot.com` (даёт 5 минут интервал на free), `https://betterstack.com`. Любой, который умеет HTTP GET по расписанию.

---

## Шаг 7 — Кастомный домен (опционально)

Если хочешь свой домен (например, `defi.kirill.dev`):

1. Купи домен (Namecheap, Reg.ru, Cloudflare Registrar)
2. В Render Dashboard → твой сервис → **Settings → Custom Domain → Add**
3. Введи домен → Render покажет какие DNS-записи добавить
4. У регистратора (или Cloudflare) добавь `CNAME` запись согласно инструкции
5. SSL-сертификат Render оформит сам через Let's Encrypt (~5 минут)

---

## Шаг 8 — Обновлять код

Любой push в `main` в GitHub → Render автоматом пересобирает и редеплоит:

```bash
cd public-app
# поправил что-то в ui/index.html
git add ui/index.html
git commit -m "update: tweak header colors"
git push
# через 5-7 минут изменения в проде
```

Можно отключить авто-деплой в `render.yaml` (`autoDeploy: false`) и катить руками через кнопку **Manual Deploy** в Render UI.

---

## Альтернатива — Fly.io

Если Render по какой-то причине не подошёл:

```bash
# установить flyctl (один раз)
curl -L https://fly.io/install.sh | sh
fly auth signup       # или auth login если есть аккаунт

# в папке public-app:
fly launch --copy-config --no-deploy   # читает fly.toml
fly deploy
fly status            # покажет URL
```

Fly даёт shared-cpu-1x с 256 МБ RAM на free, **без auto-sleep** при настройках в `fly.toml`.

---

## Что-то пошло не так?

| Симптом | Вероятная причина | Решение |
|---|---|---|
| Build падает с `boost not found` | Образ Ubuntu 22.04 не нашёл libboost-dev | Проверь Dockerfile — должна быть строка `apt-get install ... libboost-dev` |
| Build падает с network error на FetchContent | GitHub-rate-limit на анонимный пул | Подожди 5 минут, нажми Manual Deploy |
| Сервис стартует, но `/api/scan` возвращает 500 | Публичные RPC периодически падают | Открой логи, посмотри какая сеть. Можно добавить запасные RPC в `config/chains.json`, push, redeploy |
| Сервис пингуют 24/7, но всё равно засыпает | На Render free есть лимит 750ч/мес | Ничего не сделать — переезжай на Fly |
| Custom domain не работает | DNS пропагация не закончилась | Подожди до 24 часов; проверь `nslookup yourdomain.com` |

---

## Что ты получил в итоге

- Полноценный DeFi-дашборд по публичному URL
- 11 EVM-сетей: Ethereum, Arbitrum, Optimism, Base, Polygon, BNB, Avalanche, Gnosis, Linea, Scroll, Blast
- 5 функциональных вкладок: Холдинги, DeFi, Мосты, Заработок, Approvals
- Auto-deploy при push в `main`
- HTTPS бесплатно через Let's Encrypt
- $0/мес если не превышаешь free-лимиты
