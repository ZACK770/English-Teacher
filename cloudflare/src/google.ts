import { b64encode } from "./audio";

interface ServiceAccount { client_email: string; private_key: string; project_id?: string }
let cached: { token: string; expires: number; project?: string } | null = null;

const b64url = (data: Uint8Array | string) =>
  b64encode(typeof data === "string" ? new TextEncoder().encode(data) : data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/** OAuth access token for the configured Google service account (cloud-platform scope). */
export async function googleToken(serviceAccountJson: string | undefined, project?: string): Promise<{ token: string; project?: string }> {
  if (cached && cached.expires > Date.now() + 60_000) return { token: cached.token, project: cached.project };
  if (!serviceAccountJson) throw new Error("GOOGLE_TTS_SERVICE_ACCOUNT_JSON is not configured");
  const info = JSON.parse(serviceAccountJson) as ServiceAccount;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: info.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const key = await importKey(info.private_key);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`)));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${b64url(signature)}`,
    }),
  });
  if (!response.ok) throw new Error(`Google token request failed: ${response.status}`);
  const data = (await response.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, expires: Date.now() + data.expires_in * 1000, project: project || info.project_id };
  return { token: cached.token, project: cached.project };
}

export async function postJson(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return response.json();
}
