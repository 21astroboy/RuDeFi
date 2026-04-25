# DeFi Dashboard (RU)

Мультичейн веб-инструмент для крипто-портфеля. После подключения MetaMask пользователь видит:

- **Холдинги** — все балансы по 7 EVM-сетям (Ethereum, Arbitrum, Optimism, Base, Polygon, BNB, Avalanche). Native + ERC-20 через Multicall3.
- **DeFi позиции** — Aave V3 / Spark, Compound V3, Uniswap V3 LP-позиции. Health Factor, ёрнинги.
- **Мосты** — кросс-чейн через LiFi, газ в трёх валютах (token / USD / RUB).
- **Заработок** — yield-сканер по DeFiLlama (фильтры: stable-only, no-IL, по сетям и активам), idle-money калькулятор, оптимизатор.
- **Approvals** — менеджер ERC-20 разрешений с возможностью отозвать опасные.

Цены: CoinGecko. RUB-курс: ЦБ РФ. Иконки: TrustWallet.

---

## Локальный запуск (для разработки)

```bash
# macOS
brew install cmake boost curl
cmake -B build && cmake --build build -j
./build/cryptoapp serve --port 8787

# Linux
sudo apt install -y build-essential cmake libcurl4-openssl-dev libboost-dev
cmake -B build && cmake --build build -j
./build/cryptoapp serve --port 8787
```

Открой `http://127.0.0.1:8787`.

---

## Деплой на бесплатный хостинг

Готовы три рабочих варианта. Все работают без оплаты в первый месяц.

### Вариант 1 — Render.com (рекомендую, проще всего)

Render берёт репозиторий с GitHub и собирает по `Dockerfile` сам. Free-tier: 750 часов/мес.

**Шаги:**

1. Залить эту папку (`public-app/`) в новый GitHub-репозиторий:
   ```bash
   cd public-app
   git init
   git add .
   git commit -m "initial public dashboard"
   git remote add origin https://github.com/<твой_username>/<repo>.git
   git push -u origin main
   ```

2. Зайти на [render.com](https://render.com), залогиниться через GitHub.

3. Dashboard → **New +** → **Blueprint** → выбрать твой репо → Render прочитает `render.yaml` и предложит создать сервис → **Apply**.

4. Render соберёт Docker-образ (~5-7 минут) и задеплоит. По окончании выдаст URL вида `https://defi-dashboard-xxxx.onrender.com`.

5. **Важно:** на free-плане сервис **засыпает после 15 минут простоя**. Первый запрос после этого займёт 30-60 секунд (cold start). Чтобы избежать — настрой UptimeRobot или cron-job.org делать `GET /api/healthz` раз в 10 минут.

### Вариант 2 — Fly.io

Free-tier: 3 машины shared-cpu-1x с 256 МБ RAM суммарно. Не засыпает (`min_machines_running = 0` можно поставить в 1).

**Шаги:**

1. Установить flyctl:
   ```bash
   curl -L https://fly.io/install.sh | sh
   fly auth login
   ```

2. В папке `public-app/`:
   ```bash
   fly launch --copy-config --no-deploy   # читает fly.toml
   fly deploy
   ```

3. После деплоя `fly status` покажет URL вида `https://defi-dashboard.fly.dev`.

### Вариант 3 — Railway / Koyeb / Northflank / Cloud Run

Все принимают тот же `Dockerfile`. Railway сейчас не имеет постоянного free-плана, но даёт стартовые $5. Koyeb — free на 1 service. Cloud Run от Google — 2 млн запросов/мес бесплатно, но требует Google-аккаунт с биллингом.

Для каждого: подключить GitHub-репо или `docker push`, указать `PORT` env var, healthcheck `/api/healthz`.

---

## Архитектура

```
┌──────── Браузер пользователя ─────────┐
│  MetaMask + наш HTML/JS               │
│  Подключение кошелька, отправка tx    │
└───────────────────┬───────────────────┘
                    │ HTTPS
                    ▼
┌─────── Free-tier Docker-контейнер ────┐
│  cryptoapp (C++ HTTP сервер)          │
│  + статика ui/index.html              │
│  + chains.json / tokens.json          │
└────────┬────────────────────┬─────────┘
         │ HTTPS              │ HTTPS
         ▼                    ▼
   Public RPC          CoinGecko / LiFi
   (per chain)         DeFiLlama / ЦБ РФ
```

Сам бэкенд stateless — все данные тянутся из публичных RPC и API. Нет БД, нет сессий. Можно горизонтально масштабировать без проблем.

---

## Endpoints

| Endpoint | Что делает |
|---|---|
| `GET /api/healthz` | Health check для прокси/мониторинга |
| `GET /api/registry` | Список сетей и токенов (для UI dropdown'ов) |
| `GET /api/scan?wallet=0x…` | Скан портфеля по 7 сетям |
| `GET /api/bridge/quote?…` | LiFi-quote для cross-chain свопа |
| `GET /api/bridge/build-tx?…` | Готовая tx для подписания |
| `GET /api/bridge/status?…` | Статус cross-chain транзакции |
| `GET /api/security/token?…` | Goplus rug-checker |
| `GET /api/approvals?wallet=…` | Список ERC-20 approvals |
| `GET /api/gas` | Газ-снапшот по всем сетям |
| `GET /api/yield/scan?…` | DeFiLlama yields |

---

## Ограничения публичной версии

- Нет писательного состояния — каждый запрос читает заново. Если хочется кэшировать prices/yields — добавь Redis (Render предлагает бесплатный 25MB) и редактируй `pricing/price_service.cpp` чтобы пушил в него.
- Нет аутентификации — это read-only dashboard, кошелёк подключается на стороне юзера через MetaMask, приватники нигде не светятся.
- На free-тире Render сервис засыпает через 15 минут простоя — первый запрос после long idle займёт ~30-60с.

---

## Лицензия / атрибуции

- [LiFi](https://li.fi) — bridge aggregation
- [DeFiLlama](https://defillama.com) — yield data
- [CoinGecko](https://coingecko.com) — token prices
- [Trust Wallet assets](https://github.com/trustwallet/assets) — иконки
- [GoPlus](https://gopluslabs.io) — token security
- [ЦБ РФ](https://cbr.ru) — USD→RUB rate
