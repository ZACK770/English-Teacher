# Website attribution

Apply `0018_analytics.sql` before deploying this code. No existing tables are altered.
`GA_MEASUREMENT_ID` is intentionally empty; set it to the GA4 web stream ID (`G-…`)
to enable runtime loading without rebuilding the frontend. `CF_BEACON_TOKEN` is the
public speakool.net Web Analytics site token. The runtime loader avoids adding a
second beacon if Cloudflare has already injected one.

The browser stores first touch for 90 days, last visit touch, an anonymous visitor
ID, and a sessionStorage tab ID. Query parameters and token fragments are not
stored as page paths; referrer query strings are removed. Campaign fields are
limited to 200 characters. Do not put personal information in UTM parameters.
GA receives campaign fields, not customer IDs, phone numbers or email addresses.
The privacy page describes local storage, cookies and optional external analytics.

`POST /v1/public/events` accepts the six documented browser event names, bounded
JSON and same-origin requests (when Origin is present), with an atomic 120-event
per-IP/minute limit. It is not an authenticated source of payment truth.
`GET /v1/admin/analytics?start=YYYY-MM-DD&end=YYYY-MM-DD` uses the normal dashboard
authentication and returns up to 500 first-touch source/campaign groups. Dates
are inclusive UTC dates, maximum 366 days. The Hebrew Analytics tab uses this API.

Conversions in the funnel use server records only; browser copies mirror to GA4
and are excluded from conversion totals. Lead/customer/order/receipt keys make
server retries idempotent. Checkout attribution is stored separately from orders;
signed Nedarim settlement creates purchase attribution even if the browser closes.
Recurring standing-order receipts inherit the original checkout attribution.
GA4 purchase events are browser-side; server settlement is authoritative in D1.
Older clients with no valid attribution remain compatible but are not retroactively
attributed. No historical backfill is performed. Rates are event-period totals
divided by unique anonymous visitors, not cohort conversion probabilities.
