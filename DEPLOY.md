# Deploying RuDeFi

Pick one of two paths based on the state of your VPS.

| Path | Use when |
|---|---|
| **[A — Standalone](#a-standalone-shared-vps)** | VPS already runs other apps, has nginx + certbot | `./deploy-standalone.sh` |
| **[B — Full stack](#b-full-stack-fresh-vps)** | Fresh VPS with nothing on it | `./deploy.sh` |

Both paths need Docker. Both take 5–10 minutes end-to-end (dominated by the first C++ build pulling ~30 MB of deps).

---

## Prerequisites

Before you start, you need:

- A VPS running Ubuntu 22.04+ (or any Linux with Docker 20+)
- SSH access as a non-root user with `sudo`
- A domain pointed at the VPS via a DNS A record (e.g. `rudefi.example.com → 1.2.3.4`)
- An email address for Let's Encrypt renewal notices

Docker is installed with one line if you don't have it:

```bash
curl -fsSL https://get.docker.com | sudo bash
sudo usermod -aG docker $USER && newgrp docker
```

Verify: `docker version && docker compose version` should both print without errors.

---

## A — Standalone (shared VPS)

Use this when your VPS already has nginx + apps using ports 80/443. RuDeFi binds to `127.0.0.1:8080` only; your existing nginx proxies to it on a subdomain.

### 1. Pull the code onto the VPS

```bash
ssh you@your-vps
cd ~
git clone https://github.com/21astroboy/RuDeFi.git
cd RuDeFi
```

### 2. (Optional) Point a subdomain at the VPS

In your DNS provider, add an A record:

```
Type: A
Name: rudefi
Value: <IP of your VPS>
TTL:  600
```

Wait 1–30 minutes for propagation. Verify: `dig rudefi.yourdomain.ru` should return the VPS IP.

### 3. Deploy

```bash
./deploy-standalone.sh
```

The script will:
- Pre-flight check Docker, docker compose, port 8080, disk space, repo files
- Build the backend image (first time: ~5 minutes)
- Start the container on `127.0.0.1:8080`
- Wait for `/api/healthz` to respond
- Print next steps

### 4. Add an nginx server block

```bash
sudo cp nginx-snippet.conf /etc/nginx/sites-available/rudefi
sudo sed -i 's/SERVER_NAME_HERE/rudefi.yourdomain.ru/' /etc/nginx/sites-available/rudefi
sudo ln -s /etc/nginx/sites-available/rudefi /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Check: `curl -I http://rudefi.yourdomain.ru` should return `200 OK` from the RuDeFi backend.

### 5. Get an SSL certificate

```bash
sudo certbot --nginx -d rudefi.yourdomain.ru
```

Certbot will edit the nginx config in place to serve HTTPS and set up auto-renewal.

Check: `https://rudefi.yourdomain.ru` opens in a browser with a padlock.

### 6. Done

- Install as a PWA on mobile: open the URL in Safari (iOS) or Chrome (Android) → **Add to Home Screen**
- For MetaMask on mobile: use MetaMask Mobile's in-app browser and paste the URL

---

## B — Full stack (fresh VPS)

Use this when the VPS has nothing else running. RuDeFi brings its own nginx + certbot.

### 1. Pull the code

```bash
ssh you@your-vps
cd ~
git clone https://github.com/21astroboy/RuDeFi.git
cd RuDeFi
```

### 2. Point your domain at the VPS

Same as above — A record `rudefi → VPS IP`.

### 3. Open firewall ports

```bash
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable
```

Also check any cloud-provider firewall (Hetzner / DigitalOcean / etc.) and open 80 + 443 there too.

### 4. Deploy

```bash
DOMAIN=rudefi.yourdomain.ru EMAIL=you@gmail.com ./deploy.sh
```

The script:
- Builds the backend image
- Starts `app`, `nginx`, and `certbot` containers
- Requests a Let's Encrypt certificate via webroot challenge
- Reloads nginx with HTTPS enabled
- Verifies the stack

### 5. Done

`https://rudefi.yourdomain.ru` is live.

---

## Updating

```bash
cd ~/RuDeFi
./update.sh
```

Fast-forward-pulls the latest commit, rebuilds the Docker image if source changed, restarts the container, verifies health. Prints a changelog of what's new.

Manual version:

```bash
git pull
docker compose -f docker-compose.standalone.yml up -d --build   # or docker-compose.yml for full stack
```

---

## Diagnostics

### Site doesn't open / 502 Bad Gateway

```bash
docker ps                                       # all containers up?
docker logs rudefi --tail 50                    # backend errors?
curl http://127.0.0.1:8080/api/healthz          # backend reachable from host?
sudo nginx -t                                   # nginx config valid?
sudo tail -50 /var/log/nginx/error.log          # nginx-level errors?
```

### Let's Encrypt failed

Common causes:
- DNS A record hasn't propagated yet (`dig rudefi.yourdomain.ru` returns a different IP or nothing)
- Port 80 is blocked by firewall (check `sudo ufw status`, cloud-provider firewall)
- Domain hit the rate limit (max 5 certificates per domain per week — wait or use a different subdomain)

Verify port 80 is reachable from the internet:

```bash
curl -I http://rudefi.yourdomain.ru/.well-known/acme-challenge/test
# A 404 from your nginx = port 80 works, challenge path reachable
```

### Container keeps restarting

```bash
docker logs -f rudefi
```

Usual culprits:
- OOM during build on a 1 GB VPS — upgrade to 2+ GB, or build locally and `docker save` the image, `scp` and `docker load` on the server
- Missing `config/chains.json` or `config/tokens.json` (shouldn't happen — they're in the repo)

### Resource check

```bash
docker stats --no-stream
```

Normal idle:
- `rudefi` app: 50–100 MB RAM, <1% CPU
- `rudefi-nginx` (full-stack only): 5–20 MB RAM, ~0% CPU

A scan spikes app CPU to 15–40% for 2–4 seconds and RAM to 150 MB. Steady-state well under 200 MB total.

---

## SSL renewal

Let's Encrypt certs are valid 90 days. Certbot's `--nginx` plugin installs its own renewal timer, no action needed on your part.

If you want to double-check:

```bash
sudo systemctl status certbot.timer     # should be active (waiting)
sudo certbot renew --dry-run            # simulates renewal
```

For the **full-stack** deployment (nginx inside docker), add a cron:

```bash
sudo crontab -e
```

Add:

```cron
0 3 * * 0 cd /home/you/RuDeFi && docker compose run --rm --entrypoint certbot certbot renew && docker compose exec nginx nginx -s reload
```

---

## Backup

The backend is stateless — nothing to backup. The one thing worth saving is `config/settings.json` (if you edited it with an Alchemy key). Copy it to your laptop:

```bash
scp you@your-vps:~/RuDeFi/config/settings.json ~/rudefi-settings-backup.json
```

---

## Security hardening (optional)

```bash
# fail2ban — auto-ban brute-force SSH
sudo apt install fail2ban
sudo systemctl enable --now fail2ban

# unattended security upgrades
sudo apt install unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades

# Cloudflare in front of the domain (free) for DDoS + global CDN
#   1. In Cloudflare dashboard, add the domain
#   2. Change nameservers at your registrar to Cloudflare's
#   3. In Cloudflare SSL/TLS → Full (strict)
```

---

## Removing

```bash
cd ~/RuDeFi
docker compose -f docker-compose.standalone.yml down     # or docker-compose.yml
docker image prune -af
cd ~ && rm -rf RuDeFi
sudo rm /etc/nginx/sites-enabled/rudefi /etc/nginx/sites-available/rudefi
sudo nginx -t && sudo systemctl reload nginx
sudo certbot delete --cert-name rudefi.yourdomain.ru
```
