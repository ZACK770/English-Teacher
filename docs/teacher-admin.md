# Teacher administration

CRM: `/dashboard/crm?view=teachers` (הנחיות המורה) edits bot settings and restores versions. Customer cards offer **אפס ניסיון** for free usage only; this is not the destructive customer reset.

Run from the repository with Node 24+: `node scripts/teacher-admin.mjs bots`, `get <bot>`, `versions <bot>`, `set <bot> voice=Puck temperature=0.7`, `set <bot> --file settings.json`, `restore <bot> <version>`, or `reset-trial <customerId>`. Settings files contain a JSON object merged into current controls; never put credentials in them.

All writes default to **dry run**. Add `--apply` to execute. Set `ADMIN_BEARER_SECRET` for the Worker API (`SPEAKCALL_URL` defaults to `https://speakcall.app`; optionally use an `/english` base). Otherwise set `CLOUDFLARE_API_TOKEN` for direct production D1 access, using the same account/database as `set-production-bot-voices.mjs`. Never pass secrets as arguments. API credentials take precedence when both exist.

D1 mode loads the Worker's actual controls schema, ProgressStore, and trial reset implementation, via Node's built-in TypeScript transformer (no extra dependencies). Settings save/restore create a new version, not an overwrite of history. Each call loads controls from D1 at startup: saved changes apply to the next call, without deployment. Per-learner overrides still apply. D1 fallback defaults use the Worker's default transcript storage setting (`true`); existing saved controls take precedence.

Trial reset accepts customer **IDs only**, preserves receipt-linked usage (including any receipt-linked opening allocation), subscriptions, payments and identity, and audits actor `ops-cli` in D1 mode. It refuses pending settlement, active/unsettled calls, and activity within the last ten minutes. End calls and wait before retrying; do not use it to bypass payment holds. D1 dry runs perform these safety checks and report the candidate rows/seconds; API dry runs only verify the customer exists, with safety checks on apply. Production operations were not run by the implementation tests.
