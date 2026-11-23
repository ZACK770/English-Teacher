import { normalizePhone } from "./callbacks";
import { type Env, sha256Hex } from "./env";
import { campaignExternalId } from "./technoline-campaign";

const CALLER_IDS = ["0765674487", "0765674429"];
const WELCOME_FILE_ID = "1485697";

export function pirsumfonWelcome() {
  return [
    { type: "simpleMessage", files: [{ fileId: WELCOME_FILE_ID }] },
    { type: "goTo", goTo: "/" },
  ];
}

export async function pingPirsumfonCaller(env: Env, callId: string, caller: string) {
  const phone = normalizePhone(caller);
  if (!phone || !env.TLIVR_SYSTEM_API_KEY) return;
  const hash = await sha256Hex(callId);
  const claim = await env.DB.prepare(`
    INSERT OR IGNORE INTO pirsumfon_pings (sequence, call_hash)
    SELECT COALESCE(MAX(sequence), 0) + 1, ? FROM pirsumfon_pings
    RETURNING sequence
  `).bind(hash).first<{ sequence: number }>();
  if (!claim) return;
  const response = await fetch("https://api.tlivr.com/campaignApi.php", {
    method: "POST",
    headers: { "User-Agent": "speakcall-pirsumfon/1.0", "Content-Type": "application/json", Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      action: "campaignRun", apiKey: env.TLIVR_SYSTEM_API_KEY, phones: [phone],
      title: "SpeakCall Pirsumfon", messagesType: "RH", callId: CALLER_IDS[(claim.sequence - 1) % CALLER_IDS.length],
      dialRetries: 0, reasonableHours: "no", externalID: campaignExternalId("pirsumfon-" + hash),
    }),
  });
  const status = await response.json<{ status?: string; errorCode?: string | number }>();
  if (!response.ok || String(status?.status).toUpperCase() !== "OK" || String(status?.errorCode) !== "0") {
    throw new Error("Technoline did not accept Pirsumfon ping");
  }
}
