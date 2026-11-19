# Keva lifecycle synchronization

Implemented against the supplied `NedarimPlus-API.md`:

- Lines 1999–2060, https://reports.matara.pro/more/api?v=60:
  `UpdateKevaNew` supports partial updates. Family changes send only `KevaId`
  and `Amount` in shekels, plus authentication/action, without card data.
  Success is JSON `{"Result":"OK"}`; text or Result=Error is failure.
- Lines 2396–2455, https://reports.matara.pro/more/api?v=64 and `?v=65`:
  `DisableKeva` succeeds with plain text `OK`. `EnableKevaNew` succeeds with
  JSON `{"NextDate":"dd/MM/yy"}`; errors are plain text. Enable advances an
  overdue collection date by whole months, rather than charging immediately.
- All requests use FORM POST to
  https://matara.pro/nedarimplus/Reports/Manage3.aspx with `MosadId` and
  `ApiPassword` from the existing Worker environment. No card re-entry or
  saved-card recreation is needed for these actions.

Family changes update the existing Keva to the locked base price plus active
members at the locked family price. Failed updates restore the prior membership
and amount; a compensating provider update restores the old amount when an
outcome is uncertain. Failed compensation is recorded for admin reconciliation.
The prior provider amount remains an accepted, flagged fallback for late charges;
normal matching charges do not create collection issues.

Pause disables provider billing before changing entitlement status. Resume enables
billing and saves the provider's NextDate before restoring entitlement. Failed
automatic enables leave the subscription paused and create a deduplicated admin
issue. A delayed successful enable preserves all days actually frozen. Cancel
does not re-enable a deleted Keva while settling paused entitlement dates.

Migration 0017 adds a per-subscription cross-request lock (five-minute recovery
lease) and the previous billed amount. Provider calls have 15-second timeouts.
Distributed updates cannot be one atomic transaction: recovery failures are
surfaced rather than treated as success. Apply this migration before deploying
the new Worker. No production requests or migrations were made during this work.
