# QuickCompare

Compare quick-commerce prices side by side across Blinkit, Zepto, Instamart,
BigBasket, DMart and Flipkart, track things you buy often, and get pushed a
notification the moment something actually drops. Installs to your phone's home
screen as a PWA.

Runs entirely on your own machine. Nothing leaves the device.

---

## Platform status — read before you file a bug

| Platform | State |
|---|---|
| **Blinkit** | Verified working |
| **Zepto** | Verified working |
| **DMart** | Verified working |
| **Flipkart** | Verified working — see pincode note below |
| **Instamart** | Adapter written, **unverified** (blocked from the test network) |
| **BigBasket** | Adapter written, **unverified** (blocked from the test network) |
| **JioMart** | **Off by default.** Gates hard on pincode and resists automation; enable in `.env` if it works for you |
| **Amazon Now** | **Not supported.** Amazon answers automated requests with a download-trigger, and Amazon Now is app-first behind auth. No honest adapter is possible |

---

## Location needs two things, not one

Blinkit and Zepto resolve a dark store from **lat/lon**. Flipkart, DMart and
JioMart return no catalogue at all without a **pincode** — not an empty result,
literally nothing.

So Settings → Location takes both, and picking a city fills in both at once.
Twenty cities are preloaded. The city pincode is a central default; replace it
with your own for accurate stock and fees. (GPS can't tell us a pincode, so a
GPS fix borrows the nearest city's.)

If everything on Flipkart comes back "out of stock", that's the pincode — not a
parsing failure.

---

## Why it runs locally (this is the important part)

Zepto and Swiggy Instamart answer requests from datacenter IPs — cloud servers,
VPNs, proxies — with an empty page. Not an error, not a captcha: a `202` and zero
bytes. Blinkit puts Cloudflare in front of its API host.

They do **not** block normal home connections with a real browser.

So this is built as a local app driving a real Chromium via Playwright, on your
network, at a human pace. That's what makes it work at all. It also means: don't
deploy this to a VPS and expect results, and turn your VPN off before searching.

---

## Setup

```bash
npm run setup
```

That installs dependencies, downloads Chromium, generates your Web Push keys and
icons, and builds the UI. Then:

```bash
npm start
```

Open the **Network** URL it prints (e.g. `http://192.168.1.5:5177`) on your phone,
and use "Add to Home Screen".

### Set your location first

Settings → Location. Everything depends on it — which dark store serves you,
what's in stock, what it costs. "Use my GPS" is the quickest path.

---

## What it does

**Compare** — one search hits every platform and lines the results up. It shows
the cheapest sticker price *and* the best price-per-unit separately, because
they're often different rows: a 1 L pack at ₹72 (₹72/L) beats 500 ml at ₹40
(₹80/L), and the smaller number is the trap.

**Track** — watch an item and it gets re-priced in the background. Alerts fire on
your target price, a discount threshold, or a restock.

**Real deal detection** — a permanent "60% OFF" against an invented MRP is not a
deal. Every price observation is stored, so an item is only flagged when it's
genuinely below its *own* 30-day trailing median. That's the number platforms
can't manufacture.

**Deals right now** — a ranked view of everything currently worth buying, at the
top of the Tracking tab. History-backed deals outrank MRP-only ones, and until
an item has at least three price observations its deal is labelled
**unverified** — because at that point you're trusting the platform's own MRP
claim, and you should know that.

**Basket lists** — keep several named lists ("Weekly", "Monthly stock-up") and
re-price any of them in one tap. Per-item cheapest is often wrong once fees
exist: the app that wins every line can still lose the total because you didn't
clear its free-delivery threshold. So it prices your whole list on every platform
including fees, computes the split-cart option too, and tells you which wins and
by how much.

**Editable fees** — Settings → Delivery fees. The shipped numbers are estimates,
and the optimiser's answer is only as good as they are. Correct them to what you
actually get charged.

**CSV export** — Settings → Your data. Every price observation ever recorded,
with price-per-unit worked out, for your own analysis.

**Push notifications** — real Web Push, so alerts reach your lock screen with the
app closed.

**Food Rescue radar** — see the honest caveats below.

---

## Food Rescue: what's real and what isn't

Zomato's Food Rescue offers cancelled orders at a steep discount to people within
~3 km of the rider, for a few minutes.

There is **no public API and no public feed**. It is personalised, authenticated
and short-lived. Anyone promising you a clean rescue feed is selling something.

What this app actually does: drives *your own* signed-in Zomato session in the
local browser profile, re-checks the delivery surface every minute, and pushes
you a notification when a rescue card appears. Run `npm run login` once to sign
in by hand — you type your credentials into Zomato's own page, and only the
resulting session cookie is stored locally.

**Its limits, plainly:**

- Zomato pushes these mainly through its own mobile app; the web surface shows
  them inconsistently, so this will miss some.
- The claim window is minutes. A 60-second poll can arrive too late.
- It never auto-claims. It notifies you and links to the page.

Treat it as a second net. Keep Zomato's own notifications switched on — that
remains the fastest path, and this doesn't replace it.

---

## When a platform stops returning results

Check Settings → Diagnostics.

- **"blocked"** — the platform served an empty page. VPN on? Try again without
  it. Zepto and Swiggy are the usual suspects.
- **"failed" with a timeout** — the site was slow or the layout changed.
- **0 results but rendered fine** — the page structure moved. Set `HEADLESS=false`
  in `.env` and watch a search happen; you'll see immediately what changed.

Each platform lives in one file under `server/src/adapters/`, and each returns
the same shape, so fixing one is a contained job.

---

## Commands

| | |
|---|---|
| `npm run setup` | one-time install |
| `npm start` | run the app |
| `npm run dev` | dev mode, hot reload |
| `npm run login` | sign in to Zomato (or `-- blinkit`, `-- zepto`, …) |
| `npm run keys` | regenerate push keys |
| `npm run icons` | regenerate app icons |

---

## How it's put together

```
server/
  adapters/     one file per platform, all returning the same offer shape
  normalize.js  unit parsing — "2 x 200 ml" -> 400ml — and price-per-unit
  match.js      groups the same product across platforms
  engine/
    deals.js    trailing-median scoring, so fake discounts don't fire
    basket.js   whole-basket optimisation including fees
    poller.js   background re-pricing
    push.js     Web Push fan-out
    rescue.js   Zomato rescue radar
web/            React PWA, custom service worker for push
data/           SQLite + browser profile (gitignored, never leaves your machine)
```

Storage is Node's built-in `node:sqlite` — deliberately, so there's no native
build step and no Visual Studio requirement on Windows.

---

## Fair use

This reads public listing pages through a browser on your own machine, at a
human pace, for your own shopping — the same pages you'd see by hand. Keep it
that way: don't raise the poll frequency to hammer anyone, don't redistribute
scraped data, and respect these platforms' terms. Delivery fee estimates in
Settings are defaults, not quoted prices; real fees vary by city, cart value and
whatever surge is running.
