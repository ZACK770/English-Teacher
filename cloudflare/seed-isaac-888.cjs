const fs = require("node:fs");

const payload = JSON.parse(fs.readFileSync(0, "utf8"));
const row = payload[0]?.results?.[0];
if (payload[0]?.results?.length !== 1 || row?.id !== "isaac-basic" ||
    !Number.isSafeInteger(row.active_version) || row.active_version < 1 ||
    typeof row.settings_hex !== "string" || !/^[a-f0-9]+$/i.test(row.settings_hex)) {
  throw new Error("Unexpected live profile snapshot");
}

const allowed = new Set([
  "base_prompt", "opening_message", "learning_goal", "custom_instructions", "target_lesson_minutes",
  "ending_policy", "voice", "model", "language_code", "temperature", "vad_start_sensitivity",
  "vad_end_sensitivity", "vad_prefix_ms", "vad_silence_ms", "activity_handling", "turn_coverage",
  "input_batch_frames", "transcription_mode", "transcription_language_codes", "custom_vocabulary",
  "store_transcripts", "context_trigger_tokens", "context_target_tokens", "max_call_minutes",
  "idle_timeout_seconds", "idle_audio_threshold", "session_end_action",
]);
const live = JSON.parse(Buffer.from(row.settings_hex, "hex").toString("utf8"));
const settings = Object.fromEntries(Object.entries(live).filter(([key]) => allowed.has(key)));
if (!settings.base_prompt || !settings.opening_message) throw new Error("Profile snapshot is incomplete");
settings.store_transcripts = false;
const asText = (value) => "CAST(X'" + Buffer.from(value, "utf8").toString("hex") + "' AS TEXT)";
const label = asText("\u05d0\u05d9\u05d9\u05d6\u05d9\u05e7 \u00b7 \u05d1\u05e1\u05d9\u05e1\u05d9");
const now = asText(new Date().toISOString());
const sql = [
  "INSERT INTO bots (id,label,role,enabled,active_version,created_at,updated_at,phone_enabled,web_enabled) VALUES " +
    "('isaac-basic'," + label + ",'teacher',1," + row.active_version + "," + now + "," + now + ",1,0);",
  "INSERT INTO bot_versions (bot_id,version,settings_json,created_at) VALUES " +
    "('isaac-basic'," + row.active_version + "," + asText(JSON.stringify(settings)) + "," + now + ");",
].join("\n");
fs.writeFileSync(process.argv[2], sql);
console.log("Prepared settings only for isaac-basic, version " + row.active_version);
