# RuDeFi

Мультичейн DeFi-дашборд на русском. Подключаешь MetaMask (или мобильный) — видишь:

- 📊 **Холдинги** — все балансы по 11 EVM-сетям (Ethereum, Arbitrum, Optimism, Base, Polygon, BNB, Avalanche, Gnosis, Linea, Scroll, Blast)
- 🏦 **DeFi позиции** — Aave V3 / Spark, Compound V3, Uniswap V3 LP
- 🌉 **Мосты** — кросс-чейн свопы через LiFi, газ в USD/RUB/токене
- 💰 **Заработок** — yield-сканер DeFiLlama + оптимизатор idle-токенов
- 🛡 **Approvals** — менеджер ERC-20 разрешений с rug-чеком через GoPlus

Цены — CoinGecko, курс USD/RUB — ЦБ РФ, иконки — TrustWallet. Полностью open-source.

---

## Деплой на VPS

Полная инструкция от чистого Ubuntu до работающего `https://rudefi.твой-домен.ру` — см. [`DEPLOY-VPS.md`](DEPLOY-VPS.md).

Коротко: `docker compose up -d` + certbot для Let's Encrypt + nginx reverse proxy.

```bash
# На VPS:
git clone https://github.com/21astroboy/RuDeFi.git
cd RuDeFi
DOMAIN=rudefi.example.com EMAIL=you@gmail.com ./deploy.sh
```

Через 5-7 минут сайт работает по HTTPS.

---

## Мобильная версия (PWA)

На iPhone или Android открой сайт → **«Добавить на экран Домой»**. Иконка RuDeFi появится как нативное приложение, запускается full-screen без адресной строки.

### MetaMask на мобиле

- **Нативный Safari/Chrome**: window.ethereum недоступен, подключение не работает
- **MetaMask Mobile App → встроенный браузер**: открывай URL оттуда, всё работает

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

## Опционально — Alchemy

Для стабильности RPC-запросов добавь свой Alchemy ключ:

```bash
cp config/settings.example.json config/settings.json
# впиши alchemy_api_key
```

При старте бэкенд увидит ключ и будет использовать Alchemy как primary RPC для всех 11 сетей (публичные RPC останутся как fallback).

Free-tier Alchemy — 30M CU/мес, этого хватает для одного инстанса с ~100 активных пользователей.

---

## Архитектура

```
┌──────── Браузер / PWA на телефоне ─────┐
│  index.html + manifest + service worker│
│  → подключение MetaMask / мобильного   │
└───────────────────┬────────────────────┘
                    │ HTTPS
                    ▼
┌─────────── nginx (443) ─────────────────┐
│  reverse proxy, HTTP→HTTPS, rate-limit  │
│  Let's Encrypt сертификат               │
└───────────────────┬─────────────────────┘
                    │ HTTP (внутри docker net)
                    ▼
┌─────── cryptoapp C++ бэкенд (8787) ─────┐
│  /api/scan, /api/bridge/*, /api/yield/* │
│  /api/approvals, /api/gas, /api/registry│
└────────┬───────────────────┬────────────┘
         │ HTTPS             │ HTTPS
         ▼                   ▼
   Публичные RPC       CoinGecko / LiFi
   + Alchemy (опц)     DeFiLlama / ЦБ РФ
```

Бэкенд **stateless** — все данные тянутся из публичных RPC и API. Нет БД, нет сессий. Можно горизонтально масштабировать.

---

## API

| Endpoint | Что делает |
|---|---|
| `GET /api/healthz` | Health check для прокси/мониторинга |
| `GET /api/registry` | Список сетей и токенов (для UI dropdown'ов) |
| `GET /api/scan?wallet=0x…` | Скан портфеля по 11 сетям |
| `GET /api/bridge/quote?…` | LiFi-quote для cross-chain свопа |
| `GET /api/bridge/status?…` | Статус cross-chain транзакции |
| `GET /api/security/token?…` | Goplus rug-checker |
| `GET /api/approvals?wallet=…` | Список ERC-20 approvals |
| `GET /api/gas` | Газ-снапшот по всем сетям |
| `GET /api/yield/scan?…` | DeFiLlama yields |

---

## Лицензия / атрибуции

- [LiFi](https://li.fi) — bridge aggregation
- [DeFiLlama](https://defillama.com) — yield data
- [CoinGecko](https://coingecko.com) — token prices
- [Trust Wallet assets](https://github.com/trustwallet/assets) — иконки
- [GoPlus](https://gopluslabs.io) — token security
- [ЦБ РФ](https://cbr.ru) — USD→RUB rate

MIT License (code).
