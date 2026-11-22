export interface Env {
  SALES_OFFER_MODE?: "off" | "allowlist" | "on";
  SALES_OFFER_ALLOWLIST?: string;
  SALES_OFFER_PRACTICE_MINUTES?: string;
  SALES_OFFER_AUDIENCE?: "dropoffs" | "high_interest" | "quota_exhausted";
  SALES_OFFER_MIN_TUTOR_CALLS?: string;
  SALES_OFFER_MIN_TUTOR_MINUTES?: string;
  SALES_OFFER_TEST_PHONES?: string;
  GA_MEASUREMENT_ID?: string;
  CF_BEACON_TOKEN?: string;
  DB: D1Database;
  CALLS: DurableObjectNamespace;
  ASSETS: Fetcher;
  AI?: Ai;
  VOICEMAIL_AUDIO?: R2Bucket;
  RECORD_PHONE_CALLS?: string;
  GEMINI_API_KEY: string;
  CALL_REVIEW_ENABLED?: string;
  CALL_REVIEW_GEMINI_API_KEY?: string;
  TECHNOLINE_ILS_PER_MINUTE?: string;
  GEMINI_PAID_TEACHER_API_KEY?: string;
  GEMINI_BUDGET: DurableObjectNamespace;
  GEMINI_MAX_CONCURRENT?: string;
  GEMINI_DAILY_BUDGET_USD?: string;
  GEMINI_RESERVE_USD_PER_MINUTE?: string;
  GEMINI_BUDGET_EMAIL?: SendEmail;
  GEMINI_BUDGET_EMAIL_TO?: string;
  GEMINI_FAILURE_EMAIL_TO?: string;
  PORTAL_EMAIL?: SendEmail;
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
  TLIVR_CALLBACK_EXTENSION_ID?: string;
  TLIVR_CALLBACK_SECRET?: string;
  TLIVR_CALLBACK_BODY_SECRET?: string;
  TLIVR_CALLBACK_BODY_NEXT_SECRET?: string;
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
  SALES_MENU_AUDIO_URL?: string;
  SALES_MENU_AUDIO_VERSION?: string;
  SALES_MENU_MODE?: string;
  SALES_SINGLE_AUDIO_URL?: string;
  SALES_SINGLE_AUDIO_VERSION?: string;
  SALES_SERVICE_AUDIO_URL?: string;
  SALES_SERVICE_AUDIO_VERSION?: string;
  REMINDERS_MODE?: "off" | "dry_run" | "live";
  REMINDERS_ALLOWLIST?: string;
  NEDARIM_API_VALID?: string;
  NEDARIM_IFRAME_MOSAD?: string;
  CRM_EVENTS_URL?: string;
  CALLBACK_RELAY_URL?: string;
  CALLBACK_RELAY_SECRET?: string;
  CRM_INGEST_SECRET?: string;
}

const flag = (v?: string) => ["1", "true", "yes", "on"].includes((v ?? "").trim().toLowerCase());

export interface Settings {
  geminiKey: string;
  geminiLiveUrl: string;
  geminiRestUrl: string;
  basicTranslatorModel: string;
  studentId: string;
  adultStudentId: string;
  radioStreams: Record<string, string>;
  storeTranscripts: boolean;
  channelId: string;
  adultChannelId: string | null;
  enforceBearer: boolean;
  bearerSecret: string;
  returnExtension: string;
  systemPhone: string;
  projectPath: string;
  systems: { phone: string; base: string }[];
  projectEnabled: boolean;
  routerChannel: string | null;
  routerChannels: string[];
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
  const list = (value: string | undefined, fallback: string) => (value || fallback).split(",").map((v) => v.trim()).filter(Boolean);
  const phones = list(env.TLIVR_SYSTEM_PHONE, "0765673575");
  const bases = list(env.TLIVR_PROJECT_PATH, "/99").map((p) => "/" + p.replace(/^\/+|\/+$/g, ""));
  const routerChannels = list(env.TLIVR_ROUTER_CHANNEL, "");
  return {
    geminiKey: env.GEMINI_API_KEY,
    geminiLiveUrl:
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent",
    geminiRestUrl: "https://generativelanguage.googleapis.com/v1beta",
    basicTranslatorModel: "models/gemini-3.1-flash-lite",
    studentId: "student",
    adultStudentId: "adult",
    radioStreams: {
      "voice-navigator":
        "https://n-121-7.il.cdn-redge.media/livehls/oil/ch14/live/ch14/live.livx/playlist.m3u8",
    },
    storeTranscripts: env.STORE_TRANSCRIPTS === undefined ? true : flag(env.STORE_TRANSCRIPTS),
    channelId: env.TECHNOLINE_CHANNEL_ID || "2614d922d06b4f",
    adultChannelId: env.TECHNOLINE_ADULT_CHANNEL_ID || null,
    enforceBearer: flag(env.TECHNOLINE_ENFORCE_BEARER),
    bearerSecret: env.TECHNOLINE_BEARER_SECRET ?? "",
    returnExtension: "/",
    systemPhone: phones[0],
    projectPath: bases[0],
    systems: phones.map((phone, i) => ({ phone, base: bases[Math.min(i, bases.length - 1)] })),
    projectEnabled: flag(env.TLIVR_PROJECT_ENABLED),
    routerChannel: routerChannels[0] ?? null,
    routerChannels,
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

export const extensionPath = (base: string, suffix = "") => (base === "/" ? suffix || "/" : base + suffix);
export const withinBase = (base: string, path: string) => base === "/" || path === base || path.startsWith(base + "/");
