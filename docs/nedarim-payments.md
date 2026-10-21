# Nedarim Plus telephone payments

The existing `/99/3` sales callback now offers active, positive-price packages.
No package prices or commercial policies are silently created or activated.
School and translator entitlements remain separate in the existing wallet.

## Flow

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

Admin POST /v1/admin/payments/reconcile reads GetHistoryJson and GetErrorLogsJson,
advancing a persistent cursor for each source. Calls are limited to one per 3
minutes per report, including failures. An unavailable provider appears in the
panel and does not create a receipt. Mismatches/refunds/cancellations are flagged
for review rather than silently altering income or customer entitlements.

Package phone_enabled can hide a test package from callers independently of its
active flag. Authenticated /v1/admin/payments/test-order creates a payment intent
for a selected customer/package at up to ILS 1; it does not itself charge a card.

References: supplied NedarimPlus-API.md (Callback, HMAC, Get/SetWebhook) and
https://pbx.tlivr.com/apiModuleDocs.html#creditCard.
