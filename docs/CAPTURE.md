# Adding a platform from its mobile app

For **Flipkart Minutes**, **Amazon Now**, JioMart and Instamart, the website is a
dead end — interactive pincode gates that never initialise under automation, or
geo-blocking. Their **mobile apps** have neither problem: they send `lat`/`lon`
in a request and get clean JSON back.

You capture one request from the app; the adapter is then a config file, not
code. Roughly 20 minutes, once per platform.

The result is strictly better than scraping: a single JSON call instead of
driving Chromium, so searches drop from ~7s to well under a second.

---

## What you need

- An Android phone or emulator
- [HTTP Toolkit](https://httptoolkit.com) (free, easiest) or mitmproxy
- The platform's app installed

> Apps using certificate pinning may refuse to connect through a proxy. Flipkart
> and Amazon generally work on an emulator with HTTP Toolkit's interception.
> If one refuses, that platform stays unavailable — don't fight it.

---

## Capture

1. Start HTTP Toolkit → **Android device via ADB** → connect your phone/emulator.
2. Open the app, set your delivery address, and **search for something ordinary**
   like `milk`.
3. In HTTP Toolkit, find the request that returned the products. Look for a
   response containing the product names you just saw — usually a `POST` to a
   path with `search` in it.
4. Right-click → **Copy as cURL**.

---

## Turn it into an adapter

Create `data/captured/flipkart-minutes.json` (that directory is gitignored —
these files carry your auth token, so **never commit one**).

Start from the template:

```bash
cp docs/captured-example.json data/captured/flipkart-minutes.json
```

Fill in from your captured cURL:

```json
{
  "platform": "flipkart-minutes",
  "label": "Flipkart Minutes",
  "request": {
    "url": "https://<host>/<search-path>",
    "method": "POST",
    "headers": {
      "authorization": "Bearer <token from the capture>",
      "user-agent": "<user-agent from the capture>",
      "x-app-version": "<any app headers it sent>"
    },
    "body": { "query": "{{query}}", "lat": 12.9716, "lon": 77.5946 }
  },
  "map": {
    "name":     "title",
    "price":    "price.value",
    "mrp":      "price.mrp",
    "unitText": "quantity",
    "inStock":  "available"
  }
}
```

`{{query}}` is replaced with the search term — put it wherever the app put the
word you searched for.

### The map

Field paths use dots, and `[0]` for arrays: `price.offer[0].amount`.

| Key | Required | What it points at |
|---|---|---|
| `itemsPath` | no | The product array. **Omit it** and the adapter finds the longest product-shaped array itself |
| `name` | yes | Product title |
| `price` | yes | Selling price |
| `mrp` | no | Struck-through price |
| `unitText` | no | Pack size — "500 g". Without it there's no price-per-unit |
| `inStock`, `image`, `eta`, `brand`, `id`, `url` | no | As available |

Leave `itemsPath` out on the first attempt; auto-detection is usually right and
saves reading a huge payload.

---

## Test it

```bash
npm run captured -- flipkart-minutes milk
```

That prints what the adapter extracted. Two common outcomes:

- **`HTTP 401/403`** — the token expired. Re-capture. Tokens are typically good
  for days to weeks; when a platform goes quiet, this is why.
- **Rows with names but `price: null`** — your `price` path is wrong. The
  command prints one raw item so you can see the real shape.

Once it looks right, add it to `PLATFORMS` in `.env`:

```bash
PLATFORMS=blinkit,zepto,dmart,flipkart-minutes,amazon-now
```

Restart, and it appears alongside everything else — comparison, price history,
deal alerts and the basket optimiser all work with no further changes.

---

## Honest caveats

**These are private APIs.** You're reading the same data the app shows you, on
your own account, but nothing is documented and nothing is guaranteed. Endpoints
change without notice; when one does, re-capture.

**Your token is a credential.** It authenticates as you. It lives only in
`data/captured/`, which is gitignored — keep it that way, and don't paste one
into an issue or a chat.

**Keep the request rate sane.** The app's own polite cadence is the right
reference; the default 15-minute poller is already well within it.
