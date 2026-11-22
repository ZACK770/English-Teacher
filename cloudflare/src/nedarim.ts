import { type Env, HttpError } from "./env";

export function providerDay(value: unknown) {
  const match = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(String(value ?? "").trim());
  if (!match) return "";
  const [, day, month, year] = match;
  const date = `${year.length === 2 ? "20" + year : year}-${month}-${day}T00:00:00.000+00:00`;
  return Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date.slice(0, 10) ? date : "";
}

const israelOffset = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", timeZoneName: "longOffset" });
const offsetAt = (date: Date) => israelOffset.formatToParts(date).find(p => p.type === "timeZoneName")!.value.slice(3);

export function providerTime(value: unknown) {
  const match = /^(\S+)\s+((?:[01]\d|2[0-3]):[0-5]\d)(?::([0-5]\d))?$/.exec(String(value ?? "").trim());
  if (!match) return "";
  const day = providerDay(match[1]);
  if (!day) return "";
  const wall = day.slice(0, 10) + "T" + match[2] + ":" + (match[3] ?? "00");
  const offset = offsetAt(new Date(wall + "Z"));
  const date = new Date(wall + offset);
  return offsetAt(date) === offset ? date.toISOString().replace("Z", "+00:00") : "";
}

export async function manageKeva(env: Env, fields: Record<string, string>) {
  try {
    if (!env.NEDARIM_MOSAD_ID || !env.NEDARIM_API_KEY) throw new Error("Missing billing configuration");
    const response = await fetch("https://matara.pro/nedarimplus/Reports/Manage3.aspx", {
      method: "POST",
      body: new URLSearchParams({ MosadId: env.NEDARIM_MOSAD_ID, ApiPassword: env.NEDARIM_API_KEY, ...fields }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Provider unavailable");
    return await response.text();
  } catch { throw new HttpError(502, "לא הצלחנו לעדכן את הוראת הקבע בנדרים פלוס. נסו שוב או פנו לשירות."); }
}

export async function updateKevaAmount(env: Env, kevaId: string, amountAgorot: number) {
  try {
    const result = JSON.parse(await manageKeva(env, { Action: "UpdateKevaNew", KevaId: kevaId, Amount: (amountAgorot / 100).toFixed(2) }));
    if (result?.Result === "OK") return;
  } catch { /* Handled below. */ }
  throw new HttpError(502, "סכום הוראת הקבע לא עודכן בנדרים פלוס. השינוי בבני המשפחה בוטל.");
}

export async function disableKeva(env: Env, kevaId: string) {
  if ((await manageKeva(env, { Action: "DisableKeva", KevaId: kevaId })).trim() !== "OK") throw new HttpError(502, "נדרים פלוס לא אישרו את עצירת החיובים. המנוי לא הוקפא.");
}

export async function enableKeva(env: Env, kevaId: string) {
  try {
    const result = JSON.parse(await manageKeva(env, { Action: "EnableKevaNew", KevaId: kevaId }));
    const parts = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(result?.NextDate ?? "");
    if (parts) {
      const [, day, month, year] = parts;
      const date = new Date(Date.UTC(2000 + Number(year), Number(month) - 1, Number(day)));
      if (date.getUTCDate() === Number(day) && date.getUTCMonth() + 1 === Number(month)) return result.NextDate as string;
    }
  } catch { /* Handled below. */ }
  throw new HttpError(502, "נדרים פלוס לא אישרו את חידוש החיובים. המנוי נשאר מוקפא.");
}
