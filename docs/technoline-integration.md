# Technoline integration — operational handoff

Updated 2026-10-21. No credential values belong in this file.

## Deployment and current scope

Repository https://github.com/ZACK770/English-Teacher.
Feature branch feature/dynamic-bots-observability only; never publish to main.
Render IVR-DRIVER, service srv-da25qqvqj5pc73dl1be0, workspace tea-d921d428qa3s73e2jhs0.
Public origin https://ivr-driver.onrender.com; persistent database /app/data.

Current authorized PBX: **0765673575, subtree /99 ONLY**.
Root10863 is the existing taxi system: read for verification, NEVER change its
settings, other children or incoming-call routing. User will configure the routing.
Project /99 was created and read back as extension11937 on 2026-10-20.
Future dedicated system0765674434, internal100101, root11936 has locked streaming.
The user explicitly moved current implementation to the older system under99.

## Secrets and authentication

TLIVR_SYSTEM_API_KEY in Render is the active older system key; account key and
future-system key are DIFFERENT. User supplied them; do not ask to resend.
TLIVR_CALLBACK_SECRET is a separate random callback credential.
PUBLIC_BASE_URL and TLIVR_ROUTER_CHANNEL configure the shared router.
TLIVR_PROJECT_ENABLED=true; TLIVR_PROJECT_PATH=/99; TLIVR_SYSTEM_PHONE=0765673575.

System API https://api.tlivr.com/ivrFilesApi.php requires apiKey IN QUERY on this
host. POST-body-only auth incorrectly returned Unrecognized system for valid keys.
Writes are POST form encoded, with apiKey/action in query.
Never log URLs, secrets, raw provider exceptions or card fields. Both Worker
configs redact URL query strings in Cloudflare logs and traces; callback events
allowlist selected fields. Redaction does not remove already-retained logs.

### Moving callbacks to body-only authentication

Cloudflare redaction only protects requests that reach the Worker. Read back
the PBX extension settings first: the callback URL can point to a different
origin from the streaming channel, including the legacy Render service.

For extensions that use the Worker, keep the legacy credential during cutover.
Provision a distinct `TLIVR_CALLBACK_BODY_SECRET`, snapshot existing settings
without secret values, and canary an extension with a query-free URL, POST, and
the secret in `addParams.callback_key`. The [Technoline API module docs](https://pbx.tlivr.com/apiModuleDocs.html)
describe POST moving provider parameters to the form body but leaving the
configured URL unchanged. Verify the actual request and provider logs, plus
the initial and chained callbacks in a real call, before migrating other
extensions. Do not use the legacy Render reconcile operation for this migration;
it writes query credentials. Once no live extensions use the old key, remove
`TLIVR_CALLBACK_SECRET` to invalidate it. This does not change the WebSocket
channel or its token.

To rotate a body credential, set `TLIVR_CALLBACK_BODY_NEXT_SECRET` to a new
value, then update and read back every affected provider extension without
printing its settings. Once live calls confirm the affected routes, replace
`TLIVR_CALLBACK_BODY_SECRET` with the new value and remove the temporary binding.
Confirm the retired credential is rejected and the new one works.

Pre-change backups are outside Git in the current chat work/pbx-backups.
Server reconciliation saves redacted per-extension snapshots before writes.

## Synchronization architecture

app/pbx.py implements authenticated callbacks and desired-state synchronization.
POST /v1/admin/pbx/reconcile verifies PBX identity, refuses to overwrite unrelated99,
writes ONLY its fixed subtree manifest, then reads back and verifies every setting.
A failed step is not reported as synchronized. Repeated sync is idempotent.

Shared streaming endpoint /v1/technoline/router loads the selected bot from
authenticated call state. New active phone-enabled teachers automatically appear
in the phone menu: no provider channel creation per bot is needed.
Dedicated per-bot endpoints remain available for optional private channels.
phone_enabled and web_enabled allow independent channel activation.
Existing legacy streams remain backward-compatible.

Digit-to-bot mappings are snapshotted per call, preventing changed menu ordering
from selecting the wrong bot during an administrator edit.
AI segments have separate session/usage IDs and the same parent call/customer, so
several bots in one PBX call do not overwrite traces or collide in reservations.

## Telephone tree

Live (2026-11-19): english-engine serves system 0765673575 at base "/" with the
Speakool layout (/1 school, /2 personal area = options, /2/1 teacher, /2/2 lesson
type, /3 packages, /4 messages, /7 stream). The Worker quota destination is
**/88** (provisioning pending), reached only by `goTo`, not a one-digit menu key.
Root /8 (extension12239) is password-protected voiceMail, NOT the quota API;
leave it untouched. Root /6 is also reserved by the menus. The /99 Dibura subtree below
still calls the suspended Render service, not the Worker; its key9->/9 layout is
legacy and not served by cloudflare/src/pbx.ts.

### Pending Worker quota extension cutover

The shared `QUOTA_EXTENSION_PATH` in `src/pbx-paths.ts` is `/88`. Worker payment
failures, Isaac hard limits, and new default access policies use it. Explicit
`blocked_extension` policy values still win: code deployment does not repair
existing D1 rows. After provisioning /88, update **only** `blocked_extension` to
`/88` in policies `isaac-basic`, `isaac-advanced` (currently `/8`), `adult`, and
`student` (currently `/99/8`), preserving all other fields. No D1 update has been
performed. Historical SQL migrations and the legacy Python /99 reconciler retain
their original /99/8 destination; do not run that reconciler to provision /88.

Managed API creation lives in `app/pbx.py`: `PBXClient.request` and
`reconcile_project`. The admin entry point is `POST /v1/admin/pbx/reconcile`.
It is intentionally restricted to /99, not suitable for this root-level change.

Read-only verification found root id **10863**, system **0765673575**, and /4 id
**10996**, type `api`, route `/v1/technoline/ivr/service`, method `POST`, paramsMode
`chain`. Its callback credential is currently in `settings.addParams.callback_key`,
not a URL query. Never print the URL or any addParams values; preserve both forms
of authentication if the provider settings change before provisioning.

The exact creation request (NOT executed) is an HTTP POST to
`https://api.tlivr.com/ivrFilesApi.php` with query parameters `apiKey=<system key>`
and `action=extensionSet`, and this form-encoded body:

```text
extensionId=NEW
belowExtension=10863
name=Speakool · quota
extension=88
type=api
settings[url]=<derived in memory from /4 settings.url; replace only pathname with /v1/technoline/ivr/quota>
settings[paramsMode]=chain
settings[method]=POST
settings[addParams][callback_key]=<copied in memory from /4 settings.addParams.callback_key>
```

Use `GET` with `action=folderSettings&path=/4` (apiKey in the query) to obtain the
source settings; parse the URL and replace its pathname only, preserving origin,
query, and fragment. Copy every addParams entry using
`settings[addParams][<key>]`, not only callback_key if more entries appear.
Before any write, verify system identity, use `foldersList` to confirm root child
88 is absent, and save redacted snapshots outside Git. Never overwrite an existing
/88 without review. After creation read `folderSettings` at `/88`, compare URL and
auth settings in memory, and report only id/type/path/verification booleans.
Provision first, then change the policy rows and deploy; verify with a real call.
The documentation-only request above has not changed PBX routing or D1.

- /99 entry: 1 starts learning, 2 starts translation, 9 opens options.
- /99/1 direct school entry; /99/1/1 optional dynamic teacher selection.
- /99/2 translator, /99/2/1 select translator, /99/2/9 language choice.
- /99/3 information/packages; /99/4 customer voice messages.
- /99/5 course/free mode; /99/6 other bot roles.
- /99/7 shared streaming; /99/8 quota and school promotion.
- /99/9 options: teacher, course/free mode, language, packages, service.

School and translator entries now start immediately, without secondary menus.
Dedicated inbound numbers can target /99/1 or /99/2; number assignment and root
routing are unchanged. All managed extension names now use Dibura; reconciliation
recognizes the previous Isaac prefix for migration and verifies the new names.
Language key7 resets automatic Hebrew/English direction. Main key9 opens options;
the streaming bridge has no live DTMF. During AI, explicit spoken requests can
return to main/options or switch school/translator using a whitelisted end_session
destination. Google closes before transfer; each AI segment retains usage isolation.
First-service guidance is remembered only after audio is sent. Teacher, school
mode and translation language are separate persistent preferences, shared with web.
Voice language changes use save_translation_language; quoted content never implies
a settings or navigation request. See telephone-experience.md for final Hebrew copy.
Customer identity, preferred teacher/language, minutes and history are shared
between website and phone. Hidden callers remain isolated.

## Copy, audio and logs

### Approved quota-end recording (/88)

The quota menu uses Technoline file ID `1486276` from extension `14279` (`/88`),
display name `quota-charon2-49b7392d8dbf`, instead of TTS or a console narration
binding. This is Isaac's approved `Charon2.wav`, resampled to PCM16, 8 kHz mono
(12.651 seconds, 202494 bytes); the provider stores uploads as 24 kbps / 8 kHz
mono Opus. It was uploaded with `uploadFile`, `extensionId=14279`,
`checkDuplicate=STOP`, and verified with `filesList` and `fileDownload`.
The upload did not change extension settings or the PBX tree.

The recording says: "וואו, היה כיף! שיעורי הניסיון הסתיימו. כדי להמשיך ללמוד אנגלית כל יום, אפשר להצטרף עכשיו למנוי חודשי. למעבר לתפריט המנויים ולתשלום באשראי, מקישים 1."

Key 1 still transfers to `/3` (Isaac's native card extensions). Keys 0/2,
the support target 4, repeat count, timeout and error handling remain unchanged.
The separate payment-failure support notice is unchanged. No new PBX routing
setting is required: `/88` already calls `/v1/technoline/ivr/quota` with POST/chain
and body callback authentication. Merging/deploying the Worker is a separate
step; explicit D1 `blocked_extension` overrides still take precedence and must
be reviewed separately for cutover.

Telephone call recording is enabled in production by `RECORD_PHONE_CALLS="1"`
in `cloudflare/wrangler.toml`; without it phone calls are not recorded. Portal
lessons are always recorded and show a Hebrew notice before starting.
Recordings are kept 90 days.

#pbx edits live static copy without a deployment or a provider edit.
Narration library generates persistent8k mono WAV. Approved current audio can be
published to a menu slot through publish-to-ivr. PBX plays a content-addressed
fileLink from the application; no manual file upload is needed.
Editing a script invalidates its old recording and falls back to provider TTS.

Callback logs include route/input/exact outgoing JSON/latency. AI logs include
compiled prompt/setup/fingerprint/input/output and latency timeline.
A successful API check is NOT a completed telephone call. Test real audio/key
handling by dialing99 after the owner enables routing.

Sales-offer recording previews sent as `campaignRun.audioFile` are playback-only:
key 1 does not enter the Worker's offer/payment flow. Interactive offer callbacks
must use the scheduled offer binding and `messagesType=extensionActivation`
through `dialTechnolineCallback`. Simulate the authenticated POST callbacks for
`isaacOffer=1` and then `isaacPayConfirm=1` to check terms and card entry
without placing a call or charging a card.

## AI lifecycle and cost guards (2026-10-20)

Every bot's compiled prompt and Google tool schema include end_session. Model
termination closes the Google context BEFORE draining ALL already-generated
audio at real-time PCM cadence, including a padded last partial frame and a short
playback-buffer tail. There is no two-second speech cutoff. Audio/transcript parts
in the same provider packet are delivered before a terminal tool. Usage and history
are settled before a transfer; the old lease and capacity are released before the
next segment can connect. Default action
is hangup; each bot can instead return to the menu with NO AI connection left.
The phone idle watchdog defaults to60seconds, configurable15–300. It measures
human input activity (PCM RMS or learner transcription), not mere arrival of
continuous silence frames or the AI's own speech. Idle timeout cannot be disabled.
There is also a15-second missing-PBX-input guard and the existing hard call/minute
allowance timeout. All bridge tasks are cancelled and awaited on termination.

Google connection/setup has a20-second total bound. A failed or cancelled
__aenter__ explicitly closes its socket (Python otherwise never calls __aexit__).
Close handshake is bounded and the transport is aborted afterward. Web turns
and generated narrations also handle end_session and retain their finite timeouts.

Logs include ai_connection_closed, idle_timeout and phone_session_ended with reason.
Admin /v1/admin/active-ai-sessions lists currently tracked phone sessions; POST
/{call_id}/stop requests shutdown. The Calls/Performance screen exposes this control.
This registry is process-local: preserve the current single-worker deployment,
or implement shared cancellation routing before scaling workers/instances.

## Remaining commercial / provider decisions

- Technoline Asterisk20 streaming does NOT deliver DTMF today. Key9 is before
  streaming; changing language during AI conversation is by voice.
- Nedarim Plus integration was added on 2026-10-21 for Dibura institution7019554.
  See docs/nedarim-payments.md for signed settlement, refusal handling, package
  purchasing, collections console, reconciliation and the live-test status.
  Never equate a configured terminal or a passed API check with a verified phone call.
- Translator pilot defaults:2free30-second conversations/person/month; paid
  balances preferred. Nonpaying usage is advertising expense.
- School pilot:10-minute technical limit, no automatic billing gate. Final prices,
  trial terms and commercial access policy remain owner decisions.
- Source spec: current chat outputs/אפיון-ראשוני-דיבורא.md plus user wording in chat.
  Brand is provisional; final prices and full sales wording are open in that spec.

## Official references

### Campaign external IDs

`campaignRun.externalID` is limited to 50 characters by the
[campaign API docs](https://pbx.tlivr.com/campaignApiDocs.html). Generate a fresh
ID for each send: up to 17 characters of the local reference, a hyphen, and
32 random hexadecimal characters. Keep local reminder/customer-day and callback
deduplication IDs unchanged. Reusing a provider external ID returned error 54
in the authorized reminder test; a fresh ID was accepted. This does not enable
automatic reminder retries or make uncertain sends safe to retry.

### SIP test caller

Install `baresip-core` and run with Python 3.10+. Supply
`YEMOT_SIP_USER` and `YEMOT_SIP_PASSWORD` from the session's secret store;
`YEMOT_SIP_HOST` defaults to `sip.yemot.co.il`. Check credentials without
making a call: `python3 scripts/sip_test_caller.py --register-only`.

Only for an approved test, dial once and record the audio received from the IVR:

```sh
python3 scripts/sip_test_caller.py 0765673575 --max-duration 25 \
  --step wait:5 --step 'keys:2' --output /path/to/new-recording.wav
```

Steps run in order after answer. `keys:` sends SIP RTP telephone events, not
audio tones. Add `--step play:/path/to/speech.wav` for 8 kHz mono 16-bit PCM
speech (convert another format with `ffmpeg -i INPUT -ac 1 -ar 8000 -c:a pcm_s16le speech.wav`).
The recording contains received audio only; listen to it before claiming that
the menu detected a key. If testing key 2 on 0765673575, the Worker
`ivr-events` record for route `options` can also corroborate detection.
For other owner-approved test lines, set `YEMOT_SIP_ALLOWED_TARGETS` to
their comma-separated numbers. Never use customer lines. The tool does not
retry and will not overwrite recordings.

https://pbx.tlivr.com/ivrExtensionsApiDocs.html
https://pbx.tlivr.com/apiModuleDocs.html
https://pbx.tlivr.com/streamingApiDocs.html
https://app.tlivr.com/pbxDocsCenter.html
