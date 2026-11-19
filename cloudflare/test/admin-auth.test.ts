import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL as FileURL } from "node:url";
import worker from "../src/index";
import type { Env } from "../src/env";

class SqlD1 {
  sql = new DatabaseSync(":memory:");
  constructor() {
    for (const name of readdirSync(new FileURL("../migrations/", import.meta.url)).filter(name => name.endsWith(".sql")).sort()) {
      this.sql.exec(readFileSync(new FileURL("../migrations/" + name, import.meta.url), "utf8"));
    }
  }
  prepare(query: string) {
    let args: any[] = [];
    const statement = {
      bind: (...values: any[]) => { args = values; return statement; },
      first: async () => this.sql.prepare(query).get(...args) || null,
      all: async () => ({ results: this.sql.prepare(query).all(...args), success: true }),
      run: async () => ({ success: true, meta: { changes: Number(this.sql.prepare(query).run(...args).changes) } }),
    };
    return statement;
  }
  async batch(statements: any[]) {
    this.sql.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.sql.exec("COMMIT"); return results; }
    catch (error) { this.sql.exec("ROLLBACK"); throw error; }
  }
}

let db: SqlD1, env: Env;
const secret = "local-owner-password";
const base = "https://school.example";
function request(path: string, method = "GET", body?: unknown, cookie?: string, bearer?: string, origin = base) {
  return worker.fetch(new Request(base + path, {
    method, headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": "192.0.2.10", ...(cookie ? { Cookie: cookie } : {}), ...(bearer ? { Authorization: "Bearer " + bearer } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
}
async function login(username = "owner", password = secret) {
  const response = await request("/v1/admin/auth/login", "POST", { username, password });
  expect(response.status).toBe(200);
  return response.headers.get("Set-Cookie")!.split(";")[0];
}
beforeEach(() => { db = new SqlD1(); env = { DB: db as unknown as D1Database, ADMIN_BEARER_SECRET: secret } as Env; });
afterEach(() => db.sql.close());

describe("dashboard authentication", () => {
  it("rejects anonymous admin and progress reads and preserves bearer access", async () => {
    for (const path of ["/v1/admin/business/customers", "/v1/admin/users", "/v1/admin/auth/me", "/v1/progress/student", "/english/v1/admin/profiles"]) {
      expect((await request(path)).status).toBe(401);
    }
    expect((await request("/v1/admin/business/customers", "GET", undefined, undefined, secret)).status).toBe(200);
    expect((await request("/v1/admin/users", "GET", undefined, undefined, secret)).status).toBe(200);
  });
  it("bootstraps the owner with the existing secret, hashes session tokens and logs out", async () => {
    const response = await request("/v1/admin/auth/login", "POST", { username: "OWNER", password: secret });
    expect(response.status).toBe(200);
    const header = response.headers.get("Set-Cookie")!;
    expect(header).toMatch(/HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=43200/);
    const cookie = header.split(";")[0];
    expect(await (await request("/v1/admin/auth/me", "GET", undefined, cookie)).json()).toEqual({ username: "owner", role: "owner" });
    expect((await request("/v1/admin/business/customers", "GET", undefined, cookie)).status).toBe(200);
    const session = db.sql.prepare("SELECT * FROM admin_sessions").get()!;
    expect(cookie).not.toContain(String(session.token_hash));
    expect(Date.parse(String(session.expires_at)) - Date.parse(String(session.created_at))).toBeCloseTo(43200000, -2);
    expect((await request("/v1/admin/auth/logout", "POST", undefined, cookie)).headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await request("/v1/admin/auth/me", "GET", undefined, cookie)).status).toBe(401);
  });
  it("rejects wrong and empty passwords and throttles after ten failures", async () => {
    for (let i = 0; i < 10; i++) expect((await request("/v1/admin/auth/login", "POST", { username: "owner", password: i ? "wrong" : "" })).status).toBe(401);
    expect((await request("/v1/admin/auth/login", "POST", { username: "owner", password: secret })).status).toBe(429);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM admin_audit_log WHERE status=401").get()?.n).toBe(10);
    expect(JSON.stringify(db.sql.prepare("SELECT * FROM admin_audit_log").all())).not.toContain(secret);
  });
  it("creates salted staff passwords, enforces roles and invalidates disabled sessions", async () => {
    const owner = await login();
    for (const username of ["alice", "bob"]) {
      expect((await request("/v1/admin/users", "POST", { username, password: "staff-password", role: "staff" }, owner)).status).toBe(201);
    }
    const users = db.sql.prepare("SELECT * FROM admin_users WHERE role='staff'").all();
    expect(users[0].password_hash).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(users[0].password_hash).not.toBe(users[1].password_hash);
    const staff = await login("alice", "staff-password");
    for (const path of ["/v1/admin/users", "/v1/admin/audit"]) expect((await request(path, "GET", undefined, staff)).status).toBe(403);
    expect((await request("/v1/admin/users", "POST", { username: "mallory", password: "password-long" }, staff)).status).toBe(403);
    expect((await request("/v1/admin/users/" + users[0].id, "PUT", { disabled: true }, owner)).status).toBe(200);
    expect((await request("/v1/admin/auth/me", "GET", undefined, staff)).status).toBe(401);
    expect(db.sql.prepare("SELECT COUNT(*) n FROM admin_sessions WHERE user_id=?").get(users[0].id)?.n).toBe(0);
    expect((await request("/v1/admin/auth/login", "POST", { username: "alice", password: "staff-password" })).status).toBe(401);
  });
  it("rejects cross-origin and missing-origin cookie mutations, but not bearer mutations", async () => {
    const owner = await login();
    const body = { username: "alice", password: "staff-password" };
    for (const origin of ["https://foreign.example", ""]) expect((await request("/v1/admin/users", "POST", body, owner, undefined, origin)).status).toBe(403);
    expect((await request("/v1/admin/users", "POST", body, undefined, secret, "")).status).toBe(201);
    expect((await request("/v1/admin/auth/logout", "POST", undefined, owner, undefined, "https://foreign.example")).status).toBe(403);
  });
  it("audits mutation status and actor without passwords; validates users and handles empty audit", async () => {
    expect(await (await request("/v1/admin/audit", "GET", undefined, undefined, secret)).json()).toEqual({ items: [] });
    expect((await request("/v1/admin/users", "POST", { username: "alice", password: "short" }, undefined, secret)).status).toBe(422);
    expect((await request("/v1/admin/users", "POST", { username: "alice", password: "staff-password" }, undefined, secret)).status).toBe(201);
    const rows = (await (await request("/v1/admin/audit?limit=1&offset=0", "GET", undefined, undefined, secret)).json() as any).items;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "bearer", method: "POST", path: "/v1/admin/users", status: 201 });
    expect(JSON.stringify(rows)).not.toContain("staff-password");
  });
  it("rejects expired sessions and password resets revoke sessions", async () => {
    const owner = await login();
    await request("/v1/admin/users", "POST", { username: "alice", password: "staff-password" }, owner);
    const staff = await login("alice", "staff-password");
    const user = db.sql.prepare("SELECT id FROM admin_users WHERE username='alice'").get()!;
    expect((await request("/v1/admin/users/" + user.id, "PUT", { password: "replacement-password" }, owner)).status).toBe(200);
    expect((await request("/v1/admin/auth/me", "GET", undefined, staff)).status).toBe(401);
    await login("alice", "replacement-password");
    db.sql.exec("UPDATE admin_sessions SET expires_at='2000-01-01T00:00:00.000Z'");
    expect((await request("/v1/admin/auth/me", "GET", undefined, owner)).status).toBe(401);
  });
});
