import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createApiBackend, createD1Backend, createD1Database, run } from "../../scripts/teacher-admin.mjs";
import { controlsFromSettings } from "../src/controls";
import { ProgressStore } from "../src/progress";

let sql, backend, db, bodies;
const at = "2020-01-01T00:00:00Z";
beforeEach(async () => {
  sql = new DatabaseSync(":memory:"); bodies = [];
  for (const name of readdirSync(new URL("../migrations/", import.meta.url)).filter(n => n.endsWith(".sql")).sort()) sql.exec(readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"));
  const fetcher = async (_url, init) => {
    const body = JSON.parse(init.body); bodies.push(body);
    const statements = body.batch || [body];
    sql.exec("BEGIN");
    try {
      const result = statements.map(({ sql: query, params = [] }) => {
        const results = sql.prepare(query).all(...params);
        return { success: true, results, meta: { changes: Number(sql.prepare("SELECT changes() AS n").get().n) } };
      });
      sql.exec("COMMIT");
      return Response.json({ success: true, result });
    } catch (e) { sql.exec("ROLLBACK"); throw e; }
  };
  db = createD1Database("test-token", fetcher);
  backend = await createD1Backend(db);
  sql.prepare("INSERT INTO bots(id,label,role,description,audience,enabled,active_version,created_at,updated_at) VALUES ('teacher','מורה','teacher','','general',1,1,?,?)").run(at, at);
  const settings = JSON.stringify(controlsFromSettings(true));
  sql.prepare("INSERT INTO tutor_profile_settings VALUES ('teacher',?,?)").run(settings, at);
  sql.prepare("INSERT INTO bot_versions(bot_id,version,settings_json,created_at) VALUES ('teacher',1,?,?)").run(settings, at);
});
afterEach(() => sql.close());

describe("teacher admin D1 backend and SQL builders", () => {
  it("merges values, binds SQL safely, dry runs by default and atomically creates/restores versions through ProgressStore", async () => {
    expect((await run(["bots"], backend))[0].id).toBe("teacher");
    const preview = await run(["set", "teacher", "voice=Kore", "temperature=0.7"], backend);
    expect(preview).toMatchObject({ dry_run: true, new_version: 2, controls: { voice: "Kore", temperature: 0.7 } });
    expect(sql.prepare("SELECT active_version FROM bots").get().active_version).toBe(1);
    expect(bodies.some(b => b.batch)).toBe(false);
    const note = "custom_instructions=quote ' and ?; DROP TABLE bots; --";
    expect(await run(["set", "teacher", "voice=Kore", note, "--apply"], backend)).toEqual({ bot: "teacher", new_version: 2 });
    const write = bodies.find(b => b.batch);
    expect(write.batch).toHaveLength(3);
    expect(write.batch.map(s => s.sql).join(" ")).toContain("INSERT INTO bot_versions");
    expect(write.batch[0].sql).not.toContain("DROP TABLE");
    expect((await backend.get("teacher")).controls.custom_instructions).toContain("DROP TABLE bots");
    expect((await backend.versions("teacher")).map(v => v.version)).toEqual([2, 1]);
    expect(await run(["restore", "teacher", "1"], backend)).toMatchObject({ dry_run: true, new_version: 3 });
    expect(await run(["restore", "teacher", "1", "--apply"], backend)).toEqual({ bot: "teacher", new_version: 3 });
    expect((await backend.get("teacher")).controls.voice).toBe("Puck");
    const progress = new ProgressStore(db);
    expect((await progress.loadControls("teacher", controlsFromSettings(true))).voice).toBe("Puck");
    await run(["set", "teacher", "voice=Kore", "--apply"], backend);
    expect((await progress.loadControls("teacher", controlsFromSettings(true))).voice).toBe("Kore");
  });
  it("uses the actual Worker validation, refusing invalid tuning, unknown keys and missing profiles/versions", async () => {
    await expect(run(["set", "teacher", "context_target_tokens=20000", "--apply"], backend)).rejects.toThrow();
    await expect(run(["set", "teacher", "voice=not-a-voice", "--apply"], backend)).rejects.toThrow();
    await expect(run(["set", "teacher", "unknown=value"], backend)).rejects.toThrow("Unknown setting");
    await expect(run(["get", "missing"], backend)).rejects.toThrow("Bot not found");
    await expect(run(["restore", "teacher", "90", "--apply"], backend)).rejects.toThrow("Version not found");
    expect(sql.prepare("SELECT COUNT(*) AS n FROM bot_versions").get().n).toBe(1);
  });
  it("shares free-trial reset SQL, including audit, receipt protection and dry-run totals", async () => {
    sql.prepare("INSERT INTO customers(id,name,created_at,updated_at) VALUES ('customer','שם',?,?)").run(at, at);
    for (const [id, product, receipt] of [["opening", "school-opening", null], ["free", "school", null], ["paid", "school", "receipt"], ["paid-opening", "school-opening", "receipt"], ["other", "translator", null]]) sql.prepare("INSERT INTO usage_allocations VALUES (?,'customer',?,?,120,60,?)").run(id, product, receipt, at);
    expect(await run(["reset-trial", "customer"], backend)).toEqual({ dry_run: true, deleted_rows: 2, freed_seconds: 120 });
    expect(sql.prepare("SELECT COUNT(*) AS n FROM console_audit").get().n).toBe(0);
    expect(await run(["reset-trial", "customer", "--apply"], backend)).toMatchObject({ deleted_rows: 2, freed_seconds: 120, allowance: { limited: true } });
    expect(sql.prepare("SELECT call_id FROM usage_allocations ORDER BY call_id").all().map(r => r.call_id)).toEqual(["other", "paid", "paid-opening"]);
    expect(JSON.parse(sql.prepare("SELECT action FROM console_audit").get().action)).toMatchObject({ action: "crm_trial_reset", actor: "ops-cli", deleted_rows: 2 });
    expect(bodies.find(b => b.batch).batch).toHaveLength(2);
    expect(await run(["reset-trial", "customer", "--apply"], backend)).toMatchObject({ deleted_rows: 0, freed_seconds: 0 });
  });
  it.each(["active", "pending", "settlement"])("refuses %s trial resets before any D1 mutation", async mode => {
    sql.prepare("INSERT INTO customers(id,name,created_at,updated_at) VALUES ('customer','שם',?,?)").run(at, at);
    sql.prepare("INSERT INTO usage_allocations VALUES ('call','customer','school',NULL,120,?,?)").run(mode === "pending" ? null : 60, at);
    if (mode === "active") sql.prepare("INSERT INTO active_calls VALUES ('call','teacher','owner',0,?)").run(Date.now() / 1000 + 60);
    if (mode === "settlement") sql.prepare("INSERT INTO payment_orders(id,call_id,customer_id,package_id,snapshot,amount_agorot,vat_rate,state,created_at,updated_at) VALUES ('order','call','customer','p','{}',100,0,'issued',?,?)").run(at, at);
    await expect(run(["reset-trial", "customer", "--apply"], backend)).rejects.toMatchObject({ status: 409 });
    expect(bodies.some(b => b.batch)).toBe(false);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM usage_allocations").get().n).toBe(1);
  });
  it("does not include provider errors or credentials in REST failures", async () => {
    const failing = createD1Database("secret", async () => Response.json({ success: false, errors: [{ code: 123, message: "secret" }] }, { status: 403 }));
    await expect(failing.prepare("SELECT 1").all()).rejects.toThrow("D1 request failed (HTTP 403, code 123).");
  });
});

describe("teacher admin API backend", () => {
  it("honors explicit /english, defaults to dry-run preview and prints saved versions", async () => {
    const calls = [];
    const fetcher = async (url, init) => {
      calls.push([url, init]);
      return Response.json({ profile: { active_version: 2 }, controls: { voice: "Puck" } });
    };
    const api = createApiBackend("secret", "https://speakcall.app/english/", fetcher);
    expect(await run(["set", "teacher", "voice=Kore"], api)).toMatchObject({ dry_run: true });
    expect(calls[1][0]).toBe("https://speakcall.app/english/v1/admin/bots/teacher/preview");
    expect(calls[1][1].headers.Authorization).toBe("Bearer secret");
    expect(await run(["set", "teacher", "voice=Kore", "--apply"], api)).toEqual({ bot: "teacher", new_version: 2 });
    expect(calls.at(-1)[1].method).toBe("PUT");
    expect(() => createApiBackend("secret", "http://untrusted.example")).toThrow("HTTPS");
  });
});
