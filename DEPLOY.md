# Deploying QuickCompare

Two supported ways to run this without leaving your PC on. They solve different
problems — read the trade-off before picking.

| | **GitHub Actions + Pages** | **Always-on VM** |
|---|---|---|
| Cost | Free, permanently | Free on Oracle Always Free |
| Live search | No — watchlist only | Yes |
| Refresh | Every 3 hours | Every hour, plus on demand |
| Price history | Yes (committed to the repo) | Yes (SQLite) |
| Push notifications | Yes (sent from the Action) | Yes |
| Basket optimiser | No | Yes |
| Food Rescue | No | Yes |
| Setup effort | ~10 minutes | ~30 minutes |
| Maintenance | None | Occasional |

**Both are limited to Blinkit, Zepto, DMart and Flipkart.** Instamart, BigBasket
and JioMart serve empty responses to datacenter IPs. Nothing in the code can fix
that — only a residential connection reaches them, which is why running locally
(or on a Pi / old phone at home) still gives the fullest coverage.

---

## Option 1 — GitHub Actions + Pages

No server, nothing to maintain. A scheduled job scrapes your watchlist, commits
the results, and publishes a static build that reads them.

### 1. Turn on Pages

Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Do not pick "Deploy from a branch" — the workflow publishes an artifact.

### 2. Set your watchlist

Edit [`watchlist.json`](watchlist.json): your city's `lat`/`lon`/`pincode`, and
the items you actually buy. Keep it to roughly 10–15 entries; every entry costs
a page load on every platform, and hammering real shops is both rude and a fast
route to being blocked.

Commit and push. The workflow runs on push, then every 3 hours.

Your site: `https://<username>.github.io/<repo>/`

### 3. Notifications (optional)

```bash
npm run keys
```

That writes a VAPID keypair to `.env`. In the repo, under
**Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | from `.env` |
| `VAPID_PRIVATE_KEY` | from `.env` — **never commit this** |
| `VAPID_SUBJECT` | `mailto:your@email` |
| `PUSH_SUBSCRIPTION` | see below |

A static page has no backend to register a subscription with, so it goes in a
secret instead. Open the site on your phone, install it to the Home Screen, then
in Settings → Notifications use **Copy subscription** and paste the JSON into
`PUSH_SUBSCRIPTION`.

If you ever clear site data or reinstall, the subscription expires and you'll
need to repeat this. The workflow logs `expired` when that happens.

### 4. Check it ran

The **Actions** tab shows each run. A failed scrape does not take the site down —
the last good data stays published.

---

## Option 2 — Always-on VM (Oracle Cloud Always Free)

Full app: live search, basket optimiser, hourly polling, Food Rescue.

Oracle's Always Free tier is genuinely free indefinitely — up to 4 Ampere ARM
cores and 24 GB RAM. A card is required for identity verification but is not
charged. Ampere capacity is sometimes unavailable in busy regions; if creation
fails, retry later or choose another region.

Any other Linux box works identically.

### 1. Create the VM

- Shape: **VM.Standard.A1.Flex**, 2 OCPU / 12 GB is ample (1 OCPU / 6 GB is fine)
- Image: **Ubuntu 22.04**
- Add your SSH key
- Networking → add **ingress rules for TCP 80 and 443** from `0.0.0.0/0`

Oracle images also carry local firewall rules that block everything by default:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Skipping this is the single most common reason a new Oracle VM appears dead.

### 2. Get a hostname

Push notifications require a valid certificate, which requires a real hostname —
a bare IP will not do. If you don't own a domain, [DuckDNS](https://duckdns.org)
gives you one free: sign in, create `yourname.duckdns.org`, point it at the VM's
public IP.

### 3. Install and run

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER && newgrp docker

git clone https://github.com/siddhantrajnaik/COMPAREIT.git
cd COMPAREIT
cp .env.example .env
```

Edit `.env`:

```bash
DOMAIN=yourname.duckdns.org
TLS_EMAIL=your@email
LAT=12.9716
LON=77.5946
LOCALITY=Bengaluru
PINCODE=560001
```

Generate push keys and append them:

```bash
npx web-push generate-vapid-keys
```

Then start it:

```bash
docker compose up -d
```

First build takes several minutes — it downloads Chromium. Watch progress with
`docker compose logs -f app`.

Open `https://yourname.duckdns.org`, set your location in Settings, and install
to your Home Screen.

### Operating it

```bash
docker compose logs -f app        # follow logs
docker compose restart app        # restart
docker compose pull && docker compose up -d --build   # update after a git pull
```

**Back up your price history.** It's the part that can't be re-fetched, and it's
what makes "below its own 30-day median" possible:

```bash
docker run --rm -v comparelt_qc-data:/data -v $(pwd):/out alpine \
  tar czf /out/qc-backup-$(date +%F).tar.gz -C /data .
```

### If something breaks

| Symptom | Cause |
|---|---|
| Site unreachable | The iptables rules in step 1 |
| Certificate fails | DNS not pointing at the VM yet, or port 80 blocked |
| Everything "out of stock" on Flipkart | Wrong `PINCODE` |
| A platform returns 0 | Check Settings → Diagnostics; `blocked` means the IP, not the parser |
| Chromium crashes | Raise `shm_size` in `docker-compose.yml`, or use a larger shape |

---

## A note on the honest limits

Neither option reaches Instamart, BigBasket or JioMart, because both run on
datacenter IPs. If full coverage matters more than convenience, the best setup
is a small always-on machine on your home network — a Raspberry Pi, or an old
Android phone running Termux. Same code, residential IP, all seven platforms.
