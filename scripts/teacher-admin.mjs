#!/usr/bin/env node
// Node 24+: node scripts/teacher-admin.mjs bots|get BOT|versions BOT
// set BOT key=value ... | set BOT --file settings.json | restore BOT VERSION | reset-trial CUSTOMER
// Writes are dry runs unless --apply is supplied. ADMIN_BEARER_SECRET selects the admin API;
// otherwise CLOUDFLARE_API_TOKEN selects D1 REST. SPEAKCALL_URL defaults to https://speakcall.app.
import { existsSync, readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const account = "da53b4cd888030bba791621ea1a39f8c";
const database = "240c0754-3fc2-4da9-8d6e-72df75faa3a1";

export function createD1Database(token, fetcher = fetch) {
  async function query(body) {
    const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
    const data = await response.json();
    if (!response.ok || !data.success || !Array.isArray(data.result) || data.result.some(r => !r.success)) throw new Error(`D1 request failed (HTTP ${response.status}, code ${data.errors?.[0]?.code ?? "unknown"}).`);
    return data.result;
  }
  return {
    prepare(sql) {
      const statement = {
        sql, params: [],
        bind(...params) { return { ...statement, params }; },
        async first() { return (await query({ sql: this.sql, params: this.params }))[0].results[0] || null; },
        async all() { return (await query({ sql: this.sql, params: this.params }))[0]; },
        async run() { return (await query({ sql: this.sql, params: this.params }))[0]; },
      };
      return statement;
    },
    batch(statements) { return query({ batch: statements.map(({ sql, params }) => ({ sql, params })) }); },
  };
}

export async function createD1Backend(db) {
  const [{ ProgressStore }, { TutorControlsSchema, adultControls, controlsFromSettings }, { resetTrial }] = await Promise.all([
    import("../cloudflare/src/progress.ts"), import("../cloudflare/src/controls.ts"), import("../cloudflare/src/crm-reset.ts"),
  ]);
  const progress = new ProgressStore(db);
  async function get(id) {
    const profile = await progress.getBot(id);
    if (!profile) throw new Error("Bot not found.");
    return { profile, controls: await progress.loadControls(id, id === "adult" ? adultControls(true) : controlsFromSettings(true)) };
  }
  async function save(id, input, apply) {
    const current = await get(id);
    const controls = TutorControlsSchema.parse(input);
    if (!apply) return { dry_run: true, bot: id, new_version: current.profile.active_version + 1, controls };
    return { bot: id, new_version: await progress.saveControls(id, controls) };
  }
  return {
    bots: () => progress.listBots(), get,
    versions: id => progress.botVersions(id),
    set: save,
    async restore(id, version, apply) {
      await get(id);
      const selected = (await progress.botVersions(id, 100)).find(v => v.version === version);
      if (!selected) throw new Error("Version not found (only the latest 100 can be restored, as in the admin API).");
      return save(id, selected.controls, apply);
    },
    resetTrial: (id, apply) => resetTrial(db, id, "ops-cli", apply),
  };
}

export function createApiBackend(secret, base = "https://speakcall.app", fetcher = fetch) {
  const root = new URL(base);
  if (root.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(root.hostname)) throw new Error("Admin API requires HTTPS.");
  if (root.username || root.password || root.search || root.hash || !["", "/", "/english", "/english/"].includes(root.pathname)) throw new Error("SPEAKCALL_URL must be an origin, optionally ending in /english.");
  async function request(path, method = "GET", body) {
    const response = await fetcher(root.href.replace(/\/$/, "") + "/v1/admin/" + path, {
      method, redirect: "error", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Admin API failed (HTTP ${response.status}).`);
    return data;
  }
  const key = encodeURIComponent;
  return {
    bots: async () => (await request("bots")).bots,
    get: id => request("config/" + key(id)),
    versions: async id => (await request("bots/" + key(id) + "/versions")).versions,
    async set(id, controls, apply) {
      if (!apply) { await request("bots/" + key(id) + "/preview", "POST", controls); return { dry_run: true, bot: id, controls }; }
      const result = await request("config/" + key(id), "PUT", controls);
      return { bot: id, new_version: result.profile.active_version };
    },
    async restore(id, version, apply) {
      if (!apply) {
        await request("config/" + key(id));
        return { dry_run: true, bot: id, restore_version: version, note: "Version availability is checked on --apply." };
      }
      const result = await request("bots/" + key(id) + "/restore/" + version, "POST");
      return { bot: id, new_version: result.profile.active_version };
    },
    async resetTrial(id, apply) {
      if (!apply) { await request("crm/people/" + key(id)); return { dry_run: true, customer_id: id, action: "reset free trial only; safety checks run on --apply" }; }
      return request("crm/people/" + key(id) + "/reset-trial", "POST");
    },
  };
}

export async function run(args, backend) {
  const apply = args.includes("--apply");
  const [command, id, ...rest] = args.filter(a => a !== "--apply");
  if (command === "bots" && !id) return backend.bots();
  if (command === "get" && id && !rest.length) return backend.get(id);
  if (command === "versions" && id && !rest.length) return backend.versions(id);
  if (command === "reset-trial" && id && !rest.length) return backend.resetTrial(id, apply);
  if (command === "restore" && id && rest.length === 1 && /^[1-9]\d*$/.test(rest[0])) return backend.restore(id, Number(rest[0]), apply);
  if (command === "set" && id && rest.length) {
    let patch;
    if (rest[0] === "--file" && rest.length === 2) patch = JSON.parse(readFileSync(rest[1], "utf8"));
    else {
      patch = Object.create(null);
      for (const pair of rest) {
        const split = pair.indexOf("=");
        if (split < 1) throw new Error("Expected key=value or --file settings.json.");
        const key = pair.slice(0, split), raw = pair.slice(split + 1);
        try { patch[key] = JSON.parse(raw); } catch { patch[key] = raw; }
      }
    }
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Settings must be a JSON object.");
    const current = await backend.get(id);
    for (const key of Object.keys(patch)) if (!Object.hasOwn(current.controls, key)) throw new Error(`Unknown setting: ${key}`);
    return backend.set(id, { ...current.controls, ...patch }, apply);
  }
  throw new Error("Usage: teacher-admin.mjs bots | get BOT | set BOT key=value ... | set BOT --file settings.json | versions BOT | restore BOT VERSION | reset-trial CUSTOMER [--apply]");
}

function enableWorkerImports() {
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith(".") && context.parentURL && !extname(specifier)) {
        const url = new URL(specifier, context.parentURL);
        for (const suffix of [".ts", "/index.ts"]) if (existsSync(fileURLToPath(url) + suffix)) return next(url.href + suffix, context);
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.startsWith("file:") && url.endsWith(".ts")) return { format: "module", source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "transform", sourceUrl: url }), shortCircuit: true };
      return next(url, context);
    },
  });
}

async function main() {
  const secret = process.env.ADMIN_BEARER_SECRET, token = process.env.CLOUDFLARE_API_TOKEN;
  let backend;
  if (secret) backend = createApiBackend(secret, process.env.SPEAKCALL_URL);
  else if (token) { enableWorkerImports(); backend = await createD1Backend(createD1Database(token)); }
  else throw new Error("Set ADMIN_BEARER_SECRET or CLOUDFLARE_API_TOKEN in the environment.");
  console.log(JSON.stringify(await run(process.argv.slice(2), backend), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(String(error.message).replaceAll(process.env.ADMIN_BEARER_SECRET || "\0", "[REDACTED]").replaceAll(process.env.CLOUDFLARE_API_TOKEN || "\0", "[REDACTED]")); process.exitCode = 1; });
}
