export interface Env {
  DB: D1Database;
  CALLS: DurableObjectNamespace;
  ASSETS: Fetcher;
  GEMINI_API_KEY: string;
  ADMIN_BEARER_SECRET: string;
  GOOGLE_TTS_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_TTS_PROJECT?: string;
  PUBLIC_BASE_URL?: string;
  STORE_TRANSCRIPTS?: string;
  TECHNOLINE_CHANNEL_ID?: string;
  TECHNOLINE_ADULT_CHANNEL_ID?: string;
  TECHNOLINE_BEARER_SECRET?: string;
  TECHNOLINE_ENFORCE_BEARER?: string;
  TEST_TEACHER_CHANNEL_ID?: string;
  TEST_TEACHER_BEARER_SECRET?: string;
  TLIVR_SYSTEM_API_KEY?: string;
  TLIVR_CALLBACK_SECRET?: string;
  TLIVR_SYSTEM_PHONE?: string;
  TLIVR_PROJECT_PATH?: string;
  TLIVR_PROJECT_ENABLED?: string;
  TLIVR_BASIC_CHANNEL?: string;
  TLIVR_ADVANCED_CHANNEL?: string;
  TLIVR_TRANSLATOR_CHANNEL?: string;
  TLIVR_ROUTER_CHANNEL?: string;
  NEDARIM_MOSAD_ID?: string;
  NEDARIM_API_KEY?: string;
  NEDARIM_WEBHOOK_SECRET?: string;
  NEDARIM_PHONE_TERMINAL?: string;
  NEDARIM_PHONE_ENABLED?: string;
  CRM_EVENTS_URL?: string;
  CALLBACK_RELAY_URL?: string;
  CALLBACK_RELAY_SECRET?: string;
  CRM_INGEST_SECRET?: string;
  TRACCAR_FORWARD_SECRET?: string;
}

const flag = (v?: string) => ["1", "true", "yes", "on"].includes((v ?? "").trim().toLowerCase());

export interface Settings {
  geminiKey: string;
  geminiLiveUrl: string;
  geminiRestUrl: string;
  basicTranslatorModel: string;
  studentId: string;
  adultStudentId: string;
  navigationBotIds: string[];
  radioStreams: Record<string, string>;
  routesMonthlyLimit: number;
  placesMonthlyLimit: number;
  storeTranscripts: boolean;
  channelId: string;
  adultChannelId: string | null;
  enforceBearer: boolean;
  bearerSecret: string;
  returnExtension: string;
  systemPhone: string;
  projectPath: string;
  projectEnabled: boolean;
  routerChannel: string | null;
  callbackSecret: string;
  publicBaseUrl: string;
  pricing: {
    inputText: number;
    inputAudio: number;
    outputText: number;
    outputAudio: number;
    inputAudioMinute: number;
    outputAudioMinute: number;
  };
}

export function settings(env: Env): Settings {
  return {
    geminiKey: env.GEMINI_API_KEY,
    geminiLiveUrl:
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent",
    geminiRestUrl: "https://generativelanguage.googleapis.com/v1beta",
    basicTranslatorModel: "models/gemini-3.1-flash-lite",
    studentId: "student",
    adultStudentId: "adult",
    navigationBotIds: ["voice-navigator-live"],
    radioStreams: {
      "voice-navigator":
        "https://n-121-7.il.cdn-redge.media/livehls/oil/ch14/live/ch14/live.livx/playlist.m3u8",
    },
    routesMonthlyLimit: 4500,
    placesMonthlyLimit: 4500,
    storeTranscripts: env.STORE_TRANSCRIPTS === undefined ? true : flag(env.STORE_TRANSCRIPTS),
    channelId: env.TECHNOLINE_CHANNEL_ID || "2614d922d06b4f",
    adultChannelId: env.TECHNOLINE_ADULT_CHANNEL_ID || null,
    enforceBearer: flag(env.TECHNOLINE_ENFORCE_BEARER),
    bearerSecret: env.TECHNOLINE_BEARER_SECRET ?? "",
    returnExtension: "/",
    systemPhone: env.TLIVR_SYSTEM_PHONE || "0765673575",
    projectPath: env.TLIVR_PROJECT_PATH || "/99",
    projectEnabled: flag(env.TLIVR_PROJECT_ENABLED),
    routerChannel: env.TLIVR_ROUTER_CHANNEL || null,
    callbackSecret: env.TLIVR_CALLBACK_SECRET ?? "",
    publicBaseUrl: env.PUBLIC_BASE_URL ?? "",
    pricing: {
      inputText: 0.75,
      inputAudio: 3.0,
      outputText: 4.5,
      outputAudio: 12.0,
      inputAudioMinute: 0.005,
      outputAudioMinute: 0.018,
    },
  };
}

export const paymentsConfigured = (env: Env) =>
  flag(env.NEDARIM_PHONE_ENABLED) &&
  /^[0-9]{7}$/.test(env.NEDARIM_MOSAD_ID ?? "") &&
  !!env.NEDARIM_API_KEY &&
  !!env.NEDARIM_WEBHOOK_SECRET &&
  !!env.NEDARIM_PHONE_TERMINAL;

export const nowIso = () => new Date().toISOString().replace("Z", "+00:00");

export function secureEqual(actual: string | null | undefined, expected: string): boolean {
  if (actual == null || !expected) return false;
  const a = new TextEncoder().encode(actual);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function bearer(header: string | null): string | null {
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  const token = rest.join(" ");
  return scheme.toLowerCase() === "bearer" && token ? token : null;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomHex(bytes: number): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return [...values].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function tokenUrlsafe(bytes: number): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...values)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class HttpError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail);
  }
}
