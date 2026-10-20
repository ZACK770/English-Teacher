# Technoline integration — operational handoff

Last verified: 2026-10-20. No API credential values belong in this document.

## Existing deployment and credentials

- Repository: https://github.com/ZACK770/English-Teacher
- Render service: `IVR-DRIVER`, ID `srv-da25qqvqj5pc73dl1be0`
- Render workspace: `tea-d921d428qa3s73e2jhs0`
- Live application: https://ivr-driver.onrender.com
- Persistent data directory: `/app/data`
- Feature branch: `feature/dynamic-bots-observability` (verify before deployment).
- Account API URL is stored as `TLIVR_ACCOUNT_API_URL` in the service environment.
- Account API key is stored as the secret `TLIVR_ACCOUNT_API_KEY` in that environment.
- The user explicitly supplied the credential and authorized PBX/IVR implementation.
- Do not place the account key in an IVR callback URL. Use a separate callback secret.
- A secret's presence is not evidence that it is accepted by every Technoline API.

## Confirmed account API check

A form-encoded POST to `https://api.tlivr.com/accountApi.php` with the field
`apiKey` and no action returned HTTP 200, `ok: true`, account information,
one system, and an enabled API key on 2026-10-20. No mutation was performed.

The same key submitted to `https://api.tlivr.com/ivrFilesApi.php` with the documented
read action `foldersList` returned `status: ERROR`, `note: Unrecognized system`.
This is an account-key/system-key integration issue to resolve from account API
documentation; it is not evidence that the supplied account key is invalid.
Do not brute-force credentials or perform mutations while system identification
is unresolved. The user offered to provide missing documentation.

## Official documentation discovered

- Documentation index: https://app.tlivr.com/pbxDocsCenter.html
- IVR callbacks / module API: https://app.tlivr.com/apiModuleDocs.html
- Extension management API: https://app.tlivr.com/ivrExtensionsApiDocs.html
- Streaming API: https://app.tlivr.com/streamingApiDocs.html

The documentation distinguishes inbound module callbacks (PBX asks our server
for JSON instructions) from authenticated account/system management APIs.
The account API discovery/selection documentation is still needed.

## Existing application behavior

- Legacy PCM WebSocket paths remain live; bot-specific paths are
  `/v1/technoline/stream/bots/{bot_id}`.
- Policies, packages and atomic minute reservations are implemented in `business.py`.
- Admin narration generation stores 8 kHz mono WAV; automatic upload is not connected yet.
- Customer web access uses admin-issued invitations and the shared account database.
- No extension-tree mutation has been performed with this newly supplied key.

## Work still requiring the PBX connection

Read and save the real extension tree and settings before writes. Then connect
the main school menu, translator language/star menu, sales/service routes,
quota-exhausted branch, narration publishing and provider payment callbacks.
Payment confirmation must be verified and idempotent; never grant a package
just because an unauthenticated callback says `OK`.

The management console currently exposes manual payment recording and narration
download. These must not be described as automatic provider integrations.
