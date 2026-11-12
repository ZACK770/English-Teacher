# Platform data and API (navigation product)

This document is the contract for anything that builds on the voice-navigation
data: the web platform, a second AI developer, reports. Read it before writing code.

## 1. One source of truth

All data lives in **Cloudflare D1** (SQLite), behind one Worker. Nobody else
connects to the database. Clients use HTTPS + JSON only.

| Environment | Worker URL | D1 database | Data |
|---|---|---|---|
| production | `https://english-engine.a0527698420.workers.dev` | `english-engine` | real customers, live calls |
| staging | `https://english-engine-staging.a0527698420.workers.dev` | `english-engine-staging` | synthetic (`cloudflare/seed/staging.sql`) |

Build and test against **staging**. Staging has its own admin secret, no cron,
no PBX number and no Gemini/Google/Nedarim keys, so it cannot place calls,
charge money or touch the CRM.

## 2. Where each piece of data comes from

```
tracker (H02, every 2 s) → Traccar 38.49.217.185 → POST /v1/navigation/positions → navigation_positions / navigation_devices
phone → Technoline PBX → Worker + Gemini Live / Google Routes & Places → navigation_trips, conversation_turns, latency_events, navigation_usage_events
end of call → Google usage × Google price list × Bank of Israel USD/ILS (date of call) → navigation_call_costs
Nedarim Plus webhook / polling → payment_orders → sales_receipts → invoices
admin dashboard / /v1/admin/app → customers, plans, subscriptions, sim_cards, devices, invoices
web customer → /v1/app → reads the above, writes only own saved destinations
```

Google Places/Routes and Gemini are called **only by the Worker during a call**.
The web platform does not need those keys; it reads stored results (trips, calls,
costs). Costs are “calculated from reported usage”, not a Google invoice.

## 3. Tables (migration `0007_platform.sql`)

| Table | Meaning | Written by |
|---|---|---|
| `customers` | one row per person: name, `primary_phone` (digits, `05…`), status `lead/active/suspended/closed`, city, notes | admin API, legacy dashboard (dual-write), first phone call |
| `customer_phones` | phone → customer (used by the phone system to recognise the caller) | same |
| `plans` | price list. `product` = `navigation/school/translator`, `billing` = `prepaid/monthly/yearly/one_time`, `price_agorot` (₪49 = 4900) | admin API (navigation only); school/translator mirror the legacy packages |
| `subscriptions` | customer × plan, status `trial/active/past_due/cancelled/expired`, price locked at signup | admin API |
| `sim_cards` | ICCID, carrier, number, MB/month, cost/month, status | admin API |
| `navigation_devices` | tracker; inventory fields `model, imei, sim_iccid, inventory_status, sold_at` | Traccar ingest (telemetry), admin API (inventory) |
| `navigation_assignments` | which customer drives with which device | admin navigation dashboard |
| `navigation_positions` | **latest** fix per device (not history) | Traccar ingest |
| `navigation_trips` | trip history: destination, status, ETA, times, last call | phone navigation |
| `navigation_destinations` | saved destinations (“home”) | customer via web or phone |
| `call_customers`, `conversation_turns` | which call belongs to whom; transcript | phone system |
| `navigation_call_costs` | per-call cost summary in ₪ | end of call |
| `invoices` | charges. `provider` = `manual` or `nedarim`; Nedarim rows are read-only | admin API, receipt backfill |
| `app_login_codes`, `app_sessions` | web login (hashed codes/tokens) | `/v1/app/auth` |
| `console_records` | **legacy JSON**, kept for the old dashboard and English bot. Do not build on it. | legacy |

Money is always integer **agorot**. Times are ISO-8601 UTC strings, except
`*_ms` columns (Unix milliseconds).

## 4. API

Full machine-readable contract: `GET /v1/openapi.json` (OpenAPI 3.1). Give this
URL to the other AI.

### Customer (web personal area) — `/v1/app/...`

Login is phone + 6-digit code:

1. An admin (later: an automated voice call) issues a code:
   `POST /v1/admin/app/customers/{id}/login-code` → `{code, expires_at}` (10 min, 5 attempts).
2. The website sends `POST /v1/app/auth/verify {phone, code}` → `{token, expires_at}` (30 days).
3. Every other call: `Authorization: Bearer <token>`.

| Endpoint | Returns |
|---|---|
| `GET /v1/app/plans` (public) | active plans |
| `GET /v1/app/me` | profile, subscriptions, device + battery/last report |
| `GET /v1/app/device/live` | latest position; poll every 2–5 s |
| `GET /v1/app/trips?limit=&offset=` | trip history |
| `GET /v1/app/calls`, `GET /v1/app/calls/{id}/turns` | calls with ₪ cost; transcript |
| `GET /v1/app/invoices` | invoices |
| `GET/POST /v1/app/destinations`, `DELETE /v1/app/destinations/{id}` | saved destinations |
| `POST /v1/app/auth/logout` | revokes the token |

Every query is filtered by the token’s customer; another customer’s call id
returns 404. Suspended/closed customers are logged out.

### Admin — `/v1/admin/app/...`

`Authorization: Bearer <ADMIN_BEARER_SECRET>` (per environment). Customers,
plans, subscriptions, SIMs, device inventory, manual invoices, `summary`.
This key is full back-office access: keep it on a server, never in browser code.

## 5. Rules for the second AI / web developer

- Use staging URL + staging admin key only. Never ask for production keys.
- Use the API, never SQL. If a field is missing, request an API change in this repo.
- Schema changes = a new numbered file in `cloudflare/migrations/`, additive only
  (no `DROP`/rename of live columns), with a test in `cloudflare/test/`.
- Re-seed staging: `npx wrangler d1 execute english-engine-staging --env staging --remote --file seed/staging.sql`.
- Production deploys happen only when `active_calls` has no live lease, because a
  deploy drops calls in progress.

## 6. Known gaps

- Login codes are returned to the admin API; automatic delivery by voice call is not built yet.
- Position **history** is not stored (only the latest fix); trips store destination and times, not the driven path or distance.
- Navigation plans/subscriptions are not yet charged automatically through Nedarim.
