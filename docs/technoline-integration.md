# Technoline integration — operational handoff

Updated 2026-10-20. No credential values belong in this file.

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
Never log URLs, secrets, raw provider exceptions or card fields. Callback access
logs redact query strings; callback events allowlist selected fields.

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

- /99 entry, /99/1 school, /99/1/1 dynamic teacher selection.
- /99/2 translator, /99/2/1 select translator, /99/2/9 language choice.
- /99/3 information/packages; /99/4 customer voice messages.
- /99/5 course/free mode; /99/6 other bot roles.
- /99/7 shared streaming; /99/8 quota and school promotion.

School choices follow user copy:1learning,2information/sales,3service.
Translator key9 works before streaming and starts translation automatically after
the menu; key7 in language menu resets automatic Hebrew/English direction.
Customer identity, preferred teacher/language, minutes and history are shared
between website and phone. Hidden callers remain isolated.

## Copy, audio and logs

#pbx edits live static copy without a deployment or a provider edit.
Narration library generates persistent8k mono WAV. Approved current audio can be
published to a menu slot through publish-to-ivr. PBX plays a content-addressed
fileLink from the application; no manual file upload is needed.
Editing a script invalidates its old recording and falls back to provider TTS.

Callback logs include route/input/exact outgoing JSON/latency. AI logs include
compiled prompt/setup/fingerprint/input/output and latency timeline.
A successful API check is NOT a completed telephone call. Test real audio/key
handling by dialing99 after the owner enables routing.

## AI lifecycle and cost guards (2026-10-20)

Every bot's compiled prompt and Google tool schema include end_session. Model
termination closes the Google context BEFORE draining up to2seconds of already
generated audio and sending the PBX final hangup/return command. Default action
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

https://pbx.tlivr.com/ivrExtensionsApiDocs.html
https://pbx.tlivr.com/apiModuleDocs.html
https://pbx.tlivr.com/streamingApiDocs.html
https://app.tlivr.com/pbxDocsCenter.html

