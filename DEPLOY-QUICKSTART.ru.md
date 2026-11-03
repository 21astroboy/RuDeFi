# Деплой на твой VPS — чеклист

Персональная шпаргалка под `ssh algoclimb` (2.27.41.60), где уже крутятся приложения на :3000.

Для деталей и диагностики — [DEPLOY.md](DEPLOY.md) / [DEPLOY-VPS.md](DEPLOY-VPS.md).

---

## 0. На локале — запушь последний код

```bash
cd ~/Desktop/crypto-app/public-app
git push origin main
```

---

## 1. Первый деплой

```bash
ssh algoclimb
cd ~
git clone https://github.com/21astroboy/RuDeFi.git
cd RuDeFi
./deploy-standalone.sh
```

Скрипт сам:
- проверит docker и свободные порты
- соберёт C++ образ (первый раз ~5 мин)
- поднимет контейнер на `127.0.0.1:8080`
- дождётся `/api/healthz`

Проверь:
```bash
curl http://127.0.0.1:8080/api/healthz
# {"ok":true}
```

Если ответ есть — бэкенд работает. Дальше настройка nginx и SSL.

---

## 2. Nginx + поддомен

**Шаг 1 — DNS.** В панели регистратора добавь A-запись:
```
rudefi.algoclimb.ru  →  2.27.41.60
```
Подожди 5 минут, проверь:
```bash
dig +short rudefi.algoclimb.ru
# должно вернуть 2.27.41.60
```

**Шаг 2 — nginx server-блок:**
```bash
sudo cp nginx-snippet.conf /etc/nginx/sites-available/rudefi
sudo sed -i 's/SERVER_NAME_HERE/rudefi.algoclimb.ru/' /etc/nginx/sites-available/rudefi
sudo ln -s /etc/nginx/sites-available/rudefi /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**Шаг 3 — SSL от Let's Encrypt:**
```bash
sudo certbot --nginx -d rudefi.algoclimb.ru
```
На вопрос email — свою почту; на redirect HTTP→HTTPS — `2` (всегда редиректить).

**Шаг 4 — проверь:**
```bash
curl -I https://rudefi.algoclimb.ru
# HTTP/2 200
```

Открой `https://rudefi.algoclimb.ru` в браузере — должен загрузиться RuDeFi с замочком.

---

## 3. Установи как PWA на телефон

**iPhone (Safari):**
1. Открой `https://rudefi.algoclimb.ru` в Safari
2. Кнопка Share → **На экран «Домой»**
3. Иконка RuDeFi появится как обычное приложение

**Android (Chrome):**
1. Открой URL в Chrome
2. Меню (три точки) → **Установить приложение**

**MetaMask на мобиле** — работает только внутри встроенного браузера MetaMask Mobile. Открой приложение MetaMask → Browser → вставь URL. Там `window.ethereum` доступен и Connect работает.

---

## 4. Обновления (когда что-то изменится)

```bash
ssh algoclimb
cd ~/RuDeFi
./update.sh
```

Скрипт:
- делает `git pull`
- пересобирает docker-образ если код изменился
- рестартует контейнер
- проверяет health
- показывает changelog

**Если сломалось при обновлении** — откат:
```bash
git log --oneline -5     # найди последний рабочий коммит
git reset --hard <SHA>
docker compose -f docker-compose.standalone.yml up -d --build
```

---

## 5. Если что-то пошло не так

**Сайт не открывается:**
```bash
docker ps                               # контейнер жив?
docker logs rudefi --tail 50            # что говорит бэкенд?
curl http://127.0.0.1:8080/api/healthz  # отвечает ли из консоли VPS?
sudo nginx -t                           # nginx config валиден?
sudo tail -30 /var/log/nginx/error.log  # ошибки nginx?
```

**Certbot ругается:**
- DNS ещё не прописался — подожди 10 мин, перепроверь `dig rudefi.algoclimb.ru`
- Порт 80 закрыт — `sudo ufw status` (должны быть открыты 22/80/443)
- Rate-limit (5 cert/неделя на домен) — используй другой поддомен

**Контейнер падает в restart loop:**
```bash
docker logs -f rudefi
```
Обычно OOM на 1-GB VPS. Если RAM < 2 GB — собирай локально на маке и грузи на сервер:
```bash
# на маке:
docker build -t rudefi:latest .
docker save rudefi:latest | gzip > rudefi.tar.gz
scp rudefi.tar.gz algoclimb:~/

# на VPS:
docker load < ~/rudefi.tar.gz
```

**Проверить что ест ресурсы:**
```bash
docker stats --no-stream
# rudefi: 50-150 MB RAM, <1% CPU в idle
```

---

## 6. Удаление (если захочется снести)

```bash
ssh algoclimb
cd ~/RuDeFi
docker compose -f docker-compose.standalone.yml down
docker image prune -af
cd ~ && rm -rf RuDeFi
sudo rm /etc/nginx/sites-enabled/rudefi /etc/nginx/sites-available/rudefi
sudo nginx -t && sudo systemctl reload nginx
sudo certbot delete --cert-name rudefi.algoclimb.ru
```

---

## Чеклист после деплоя

- [ ] `https://rudefi.algoclimb.ru` открывается с замочком SSL
- [ ] `docker ps` показывает `rudefi` в состоянии `Up (healthy)`
- [ ] `curl -I https://rudefi.algoclimb.ru/api/healthz` → `200 OK`
- [ ] MetaMask подключается с десктопа
- [ ] На iPhone добавил через «На экран Домой», открывается fullscreen
- [ ] Из MetaMask Mobile встроенного браузера Connect работает
- [ ] `./update.sh` отрабатывает без ошибок (прогони один раз для проверки)
- [ ] Другие приложения на `:3000/teacher` и т.д. всё ещё работают
