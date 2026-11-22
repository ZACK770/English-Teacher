# Tutor lab (isolated)

Run from the repo root with the existing Cloudflare toolchain:

```sh
npx tsc --noEmit -p lab
cloudflare/node_modules/.bin/wrangler dev --config lab/wrangler.toml
```

Local secrets can be inherited from the environment with `CLOUDFLARE_INCLUDE_PROCESS_ENV=true`
or placed in ignored `lab/.dev.vars`. Required: `LAB_PASSCODE`, `GEMINI_API_KEY`.
Optional: `OPENAI_API_KEY` (without it B is disabled). `CLOUDFLARE_API_TOKEN`
must permit Workers AI for the remote AI binding used even during local dev.
Never commit secret values. Use HTTPS or localhost for microphone access.

When authorized to deploy (not part of this change):

```sh
cloudflare/node_modules/.bin/wrangler secret put LAB_PASSCODE --config lab/wrangler.toml
cloudflare/node_modules/.bin/wrangler secret put GEMINI_API_KEY --config lab/wrangler.toml
cloudflare/node_modules/.bin/wrangler secret put OPENAI_API_KEY --config lab/wrangler.toml
cloudflare/node_modules/.bin/wrangler deploy --config lab/wrangler.toml
```

Only `tutor-lab` is targeted. No D1, PBX, or english-engine bindings/secrets.
Use a strong unique passcode; it is saved in localStorage (clear site storage to forget).
Audio/text goes to the selected providers; no lab persistence. Don't use sensitive speech.
The lab reuses `buildSystemInstruction(adultControls(false), "")`, the Alex profile
used by `session.ts` and `compilePrompt` in the real tutor. Production per-customer
overrides and lesson persistence tools are intentionally absent: this is a voice/model
comparison, not a school session. Tool requests in the shared persona cannot save progress.
Male voices: Gemini Charon, OpenAI cedar. B uses server VAD and has no separate
input transcription service (to avoid extra transcription charges); output transcripts
are shown. A keeps up to 40 history messages and limits each recording to 60 seconds.

Prices in USD: Whisper $0.000513/min; Gemma $0.10/$0.30 per M input/output;
Gemini `gemini-3.8-flash-lite-tts` $0.50 text input / $6 audio output per M,
25 audio tokens/sec fallback if audio usage details absent. Model availability checked
via Gemini models list; pricing checked at https://ai.google.dev/gemini-api/docs/pricing.
These TTS prices apply through 2026-12-31; update before 2027 ($1/$12).
Realtime mini: audio $10/$20 per M, cached input $0.30; text $0.60/$2.40,
cached input $0.06. Usage from `response.done` includes cache modality breakdown.
Totals cover successful reported turns only; provider failures may incur partial charges.
$/minute is call wall time, not billed audio time. Baseline: $0.054/min.
