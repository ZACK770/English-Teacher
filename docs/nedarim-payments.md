# Nedarim Plus telephone payments

## Existing SpeakCall standing orders (Cloudflare)

The hourly standing-order sync imports monthly orders in the Nedarim category
`חבילות ספיקול` only if the payer matches an existing primary phone and the
latest charge is confirmed, positive, and still covers the current period.
An enabled order alone is not proof of payment. The legacy ₪49 rate uses the
Step plan's minutes and keeps its actual rate; other rates must match exactly
one active monthly school plan. Unknown phones, prices and conflicts are left
untouched. Website checkout remains separate.

The import creates the paid receipt and subscription atomically without
charging or changing the order in Nedarim. Subsequent charges use the existing
signed webhook and admin reconciliation. An operator can run the same sync
with authenticated `POST /v1/admin/nedarim/kevas/sync`.

The existing `/99/3` sales callback now offers active, positive-price packages.
No package prices or commercial policies are silently created or activated.
School and translator entitlements remain separate in the existing wallet.

## Flow

The five school phone sales keys are fixed: 1 Start, 2 Small Talk, 3 Pro,
4 Max (six months), 5 Master (twelve months); 0 returns and 9 opens service.
`SALES_MENU_AUDIO_URL` and `SALES_MENU_AUDIO_VERSION` select one combined
Technoline `fileLink` with the cache key `sales-menu-<version>`. Set both to
use the recording; otherwise the approved menu text is spoken with TTS.
Terms key 2 reads the terms and returns to the terms menu; key 1 authorizes
continuing to the provider's card collection, and 0 cancels.

### Opt-in Start-first funnel (draft, pending Isaac's approval)

Only `SALES_MENU_MODE=single` enables this funnel and its shorter terms.
Missing, empty, or any other value preserves the existing menu and terms.
Do not enable it until Isaac approves the following caller-facing drafts.

First menu (`isaacSinglePackage`):

> מומלץ להתחיל בסטארט: 3 אימונים בשבוע, ב־59 שקלים לחודש. להצטרפות הקישו 1. לכל החבילות הקישו 9. לביטול מנוי הקישו 8. לחזרה הקישו 0.

Key 1 uses the existing `school-step` purchase path. Key 9 opens the unchanged
five-package menu, including its existing `SALES_MENU_AUDIO_*` recording. Key 9
in that full menu still opens service at `/4`, relative to the project base.
Key 8 in the first menu requests subscription cancellation and currently
hands off to the same service destination; it does not cancel automatically.
Key 0 returns to the main menu. If Start's price/cadence/availability no longer
matches the draft, entry falls back to the full catalog and the Start shortcut
does not create an order. No catalog values are changed by this switch.

The first menu uses Technoline text TTS unless both `SALES_SINGLE_AUDIO_URL`
and `SALES_SINGLE_AUDIO_VERSION` are set; then its file cache name is
`sales-single-<version>`. These settings do not affect full-menu audio.

Short terms step:

> לאישור התקנון ולהמשך לתשלום הקישו 1. לשמיעת התקנון הקישו 2. לביטול הקישו 0.

Short terms playback:

> מנוי חודשי מתחדש באשראי וניתן לביטול בכל עת, ללא התחייבות. מקס לחצי שנה ומאסטר לשנה משולמים מראש, בתשלום אחד או בתשלומים. התשלום מאובטח דרך נדרים פלוס. לעזרה ולביטול פנו לשירות.

Both terms texts use Technoline text TTS, not an R2 or PBX recording. Key 2
reads the terms and repeats the step; key 1 continues to card collection and
key 0 cancels. The shorter drafts omit internal minute quotas; the legacy
terms remain unchanged when the switch is off.

For fixed-term packages the provider receives `paymentsMode: "regular"` and
`payments: 6` (Max) or `payments: 12` (Master). The official
[creditCard documentation](https://pbx.tlivr.com/apiModuleDocs.html#creditCard)
defines `payments` as “מקסימום תשלומים. 1 = לא ישאל. >1 = ישאל בין 1 ל-X”,
and `regular` as “חיוב רגיל (תפיסת מסגרת אשראי)”. Monthly packages retain
`paymentsMode: "kevaMonthly"`. Verified settlements of fixed-term phone
purchases create the same subscription entitlements as web purchases.
No provider routing changes are made by this flow.

Monthly phone enrollment uses `kevaMonthly`. Only a fresh in-call PBX OK can
claim a first charge (migration `0031_phone_keva_first_charge.sql`): its confirmation
is the KevaId, checked through `GetKevaId` against the saved order, primary phone,
institution, active monthly ILS status, creation date and empty history. A previously
successful history activates through the ordinary verification path instead.
`TashlumBodedNew` charges the saved order amount with `JoinToKevaId=Join` and a stable
`AjaxId=dibura-first-<orderId>`. The permanent DB claim is never expired or retried:
provider AjaxId duplicate errors do not return the original transaction result.
Existing awaiting orders and scheduled reconciliation never initiate this charge.

Before any first charge, `UpdateKevaNew` must confirm (`Result=OK`) moving NextDate
one calendar month forward, in `dd/MM/yyyy` format. If this fails or is unknown,
no charge is attempted: the order remains awaiting settlement with an open
`phone_keva_next_date` issue. On verified charge success, the returned TransactionId
(or ID alias) activates the saved subscription and receipt; Confirmation is retained
when supplied. Inspect unresolved issues in the customer's CRM before any manual
collection. Declines (`Status=Error`)
fail the order and delete the Keva; deletion failures have a separate issue.
Unknown/network results leave the order awaiting settlement and never delete or
retry the Keva. Scheduled verification can still recover a later successful charge.

The API documentation has two spellings for the charge installment count:
`Tashloumim` and `Tashlumim`; both are sent as 1. The Manage3 adapter's `MosadId`
and the documented `MosadNumber` are both sent for the charge. Update responses
use `Result`, immediate-charge responses use `Status`, and DeleteKeva returns
plain text `OK`. No raw provider response or card fields are stored.

### One-time phone purchases

1. The authenticated PBX callback identifies the customer from the caller number.
2. Menu positions are snapshotted for the call. Selecting a package freezes its
   price, product, minutes, validity and VAT rate in a persistent payment order.
3. The caller hears the full terms and confirms a one-time card payment.
4. The server atomically marks the order issued before returning Technoline's
   documented `creditCard` module, with the configured provider terminal and
   `category=dibura-<random order id>`. The PBX collects the card; this app never does.
5. A PBX OK is informational only. An authenticated Nedarim HMAC webhook must
   match institution, random category, amount, ILS currency and a transaction ID
   plus approval before an atomic wallet receipt is inserted.
6. Duplicate callbacks do not issue another charge instruction. Duplicate
   provider transactions do not grant another package. The receipt reference is
   `nedarim:<institution>:<transaction>`. Extra payments require administrator review.

The provider module itself offers another-payment functionality after success;
an extra payment under the same order is intentionally not credited automatically.
Cancellation/failure offers service or return, rather than automatically charging again.
Orders have one purchase per telephone call; selected orders expire after 30 minutes.

## Configuration (secrets in Render only)

- NEDARIM_MOSAD_ID: institution 7019554 (Dibura).
- NEDARIM_API_KEY: institution API credential, never in code or browser bundles.
- NEDARIM_WEBHOOK_SECRET: generated `whsec_` secret, shared with Nedarim.
- NEDARIM_PHONE_TERMINAL: Nedarim provider terminal for the PBX `terminal` field.
- NEDARIM_PHONE_ENABLED: feature gate, false until configured.

Nedarim API authentication, credit availability and the previously empty webhook
configuration were verified read-only on 2026-10-21. A completed live telephone
payment is a separate check; do not describe configuration checks as a live charge.

Webhook: `https://ivr-driver.onrender.com/v1/payments/nedarim/webhook`.
Use GetWebhook before SetWebhook; never silently overwrite another destination.
Install the secret on the app before SetWebhookSecret and activating delivery.
HMAC is calculated over the exact raw bytes with a 5-minute timestamp window.
Unknown categories are acknowledged without granting access. Invalid amounts,
institution, signatures, currencies or confirmations fail closed.

Admin read-only status: GET `/v1/admin/payments/status` (existing admin bearer).
The existing PBX config response also exposes `payment_configured`.

## Recovery and limits

If a payment stays pending, inspect its order and the Nedarim transaction history.
Do not tell the caller to pay again merely because a callback was delayed.
Nedarim does not automatically retry webhooks. Use the panel's reconciliation
button to recover missing transactions and refusals through authenticated history.
The app does not automatically reverse wallet credits on refunds.
Refunds and extra payments require administrator review. Manual receipt tools
remain available and must not duplicate the `nedarim:` transaction reference.

All changes are confined to the existing feature branch. The PBX root and taxi
extensions are untouched; the current `/99/3` API extension needs no tree change.

## Validation

76 tests pass, including payment cases for signature/replay rejection,
duplicate delivery, simultaneous settlement, mismatched amounts, currency and
institution, refusal, frozen commercial terms and separate product balances.
Ruff passes. A user-authorized live test charged ILS 1 on 2026-10-21 through
the Nedarim administration form (transaction 81374766, confirmation 0764209).
The signed callback created one receipt and one minute for the test customer;
history reconciliation matched it without creating another receipt or minute.
The hidden test package was then deactivated. No card data is stored here.
This validates settlement and accounting; a live telephone audio/DTMF purchase
has not yet been exercised.

## Collections console

The Packages screen includes confirmed/manual totals, pending sums (not revenue),
order state filters and pagination, customer names/phones, provider transaction
IDs, refusal reasons, an issue queue and audited resolution notes. Customer lists
and customer details include payment state and history. No payment on record
does not imply a debt. No declined/pending order becomes a financial receipt.

Signed refusal events are accepted at the same webhook URL; configure Type=Siruv
as well as Type=Transaction in Nedarim. Provider messages are sanitized and long
number strings removed. No card number or CVV is collected by the app.

The ten-minute cron and admin POST /v1/admin/payments/reconcile read
GetHistoryJson and GetErrorLogsJson with a persistent cursor per report.
Refusals use the provider event time in Israel; an older refusal cannot block a
newer verified payment. A current refusal holds the standing order's access and
minutes, not other purchases. The notice appears in the portal and when calling
the school without other usable minutes. A later verified charge clears the hold.
An unseen charge whose timestamp cannot establish its place after the latest
charge or refusal is flagged for billing review instead of granting another period.

A full credit in GetHistoryJson is matched by the original transaction ID in
`זיכוי עסקה:` and its amount. Its minutes stay reversed; only a reversal of the
latest payment holds the standing order. Partial or unlinked credits do not
block access. Bank Masav returns do not use the credit-card KevaId and are not
automatically matched. Deployment requires migration 0022 before serving traffic.

Package phone_enabled can hide a test package from callers independently of its
active flag. Authenticated /v1/admin/payments/test-order creates a payment intent
for a selected customer/package at up to ILS 1; it does not itself charge a card.

References: supplied NedarimPlus-API.md (Callback, HMAC, Get/SetWebhook) and
https://pbx.tlivr.com/apiModuleDocs.html#creditCard.
