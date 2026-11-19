import { type Env, HttpError, bearer, secureEqual, sha256Hex, randomHex } from "./env";

type Identity = { id: string; username: string; role: "owner" | "staff"; bearer?: boolean };
type User = Identity & { password_hash: string | null; disabled: number };
const loginPath = "/v1/admin/auth/login";
const cookie = (token: string, age = 43200) => `admin_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${age}`;
const ip = (r: Request) => r.headers.get("CF-Connecting-IP") || "unknown";
const stamp = () => new Date().toISOString();

export async function audit(env: Env, request: Request, path: string, actor: string, status: number, detail: string | null = null) {
  await env.DB.prepare("INSERT INTO admin_audit_log (id,ts,actor,method,path,status,ip,detail) VALUES (?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), stamp(), actor, request.method, path, status, ip(request), detail).run();
}

async function derive(password: string, salt: string, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations }, key, 256);
  return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, "0")).join("");
}
export async function hashPassword(password: string) {
  const salt = randomHex(16), iterations = 100000;
  return `pbkdf2-sha256$${iterations}$${salt}$${await derive(password, salt, iterations)}`;
}
async function verify(password: string, hash: string) {
  const [algorithm, count, salt, digest] = hash.split("$");
  if (algorithm !== "pbkdf2-sha256" || Number(count) < 100000 || !salt || !digest) return false;
  return secureEqual(await derive(password, salt, Number(count)), digest);
}

export async function adminIdentity(request: Request, env: Env): Promise<Identity | null> {
  if (secureEqual(bearer(request.headers.get("Authorization")), env.ADMIN_BEARER_SECRET)) return { id: "bearer", username: "bearer", role: "owner", bearer: true };
  const token = request.headers.get("Cookie")?.match(/(?:^|;\s*)admin_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) return null;
  return env.DB.prepare("SELECT u.id,u.username,u.role FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0")
    .bind(await sha256Hex(token), stamp()).first<Identity>();
}
export function requireOrigin(request: Request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) throw new HttpError(403, "Invalid origin");
}
async function input(request: Request): Promise<Record<string, unknown>> {
  try { const value = await request.json(); if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>; } catch { /* invalid input */ }
  throw new HttpError(422, "Invalid JSON");
}
function passwordValue(value: unknown) {
  if (typeof value !== "string" || value.length < 10 || value.length > 1024) throw new HttpError(422, "Password must be 10–1024 characters");
  return value;
}

export async function adminAuth(request: Request, env: Env, path: string): Promise<Response> {
  if (path === loginPath && request.method === "POST") {
    requireOrigin(request);
    const data = await input(request);
    const username = typeof data.username === "string" ? data.username.trim().toLowerCase().slice(0, 64) : "";
    const password = typeof data.password === "string" ? data.password : "";
    const failures = await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE actor=? AND ip=? AND path=? AND status=401 AND ts>?")
      .bind(username, ip(request), loginPath, new Date(Date.now() - 900000).toISOString()).first<{ n: number }>();
    if ((failures?.n || 0) >= 10) throw new HttpError(429, "Too many attempts");
    let user = await env.DB.prepare("SELECT * FROM admin_users WHERE username=?").bind(username).first<User>();
    const bootstrap = username === "owner" && secureEqual(password, env.ADMIN_BEARER_SECRET);
    const valid = password.length <= 1024 && (bootstrap || await verify(password, user?.password_hash || `pbkdf2-sha256$100000$dummy$invalid`));
    if (!valid || user?.disabled) throw new HttpError(401, "Invalid credentials");
    if (!user && bootstrap) {
      await env.DB.prepare("INSERT OR IGNORE INTO admin_users (id,username,display_name,role,created_at) VALUES ('bootstrap-owner','owner','Owner','owner',?)").bind(stamp()).run();
      user = await env.DB.prepare("SELECT * FROM admin_users WHERE username='owner'").first<User>();
    }
    if (!user) throw new HttpError(401, "Invalid credentials");
    const token = randomHex(32), now = stamp();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO admin_sessions (token_hash,user_id,created_at,expires_at,ip,user_agent) VALUES (?,?,?,?,?,?)").bind(await sha256Hex(token), user.id, now, new Date(Date.now() + 43200000).toISOString(), ip(request), (request.headers.get("User-Agent") || "").slice(0, 512)),
      env.DB.prepare("UPDATE admin_users SET last_login_at=? WHERE id=?").bind(now, user.id),
    ]);
    return Response.json({ username, role: user.role }, { headers: { "Set-Cookie": cookie(token), "Cache-Control": "no-store" } });
  }
  const identity = await adminIdentity(request, env);
  if (!identity) throw new HttpError(401, "Unauthorized");
  if (path === "/v1/admin/auth/me" && request.method === "GET") return Response.json({ username: identity.username, role: identity.role }, { headers: { "Cache-Control": "no-store" } });
  if (path === "/v1/admin/auth/logout" && request.method === "POST") {
    if (!identity.bearer) requireOrigin(request);
    const token = request.headers.get("Cookie")?.match(/(?:^|;\s*)admin_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (token) await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(await sha256Hex(token)).run();
    return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie("", 0) } });
  }
  throw new HttpError(404, "Not found");
}

export async function adminOwners(request: Request, env: Env, path: string, identity: Identity): Promise<Response | null> {
  if (path !== "/v1/admin/audit" && path !== "/v1/admin/users" && !path.startsWith("/v1/admin/users/")) return null;
  if (identity.role !== "owner") throw new HttpError(403, "Owner required");
  if (path === "/v1/admin/audit" && request.method === "GET") {
    const params = new URL(request.url).searchParams;
    const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 50));
    const offset = Math.max(0, Number(params.get("offset")) || 0);
    const rows = await env.DB.prepare("SELECT * FROM admin_audit_log ORDER BY ts DESC LIMIT ? OFFSET ?").bind(limit, offset).all();
    return Response.json({ items: rows.results }, { headers: { "Cache-Control": "no-store" } });
  }
  if (path === "/v1/admin/users" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT id,username,display_name,role,disabled,created_at,last_login_at FROM admin_users ORDER BY username").all();
    return Response.json({ items: rows.results }, { headers: { "Cache-Control": "no-store" } });
  }
  if (request.method !== "POST" && request.method !== "PUT") throw new HttpError(405, "Method not allowed");
  const data = await input(request);
  if (data.role !== undefined && data.role !== "owner" && data.role !== "staff") throw new HttpError(422, "Invalid role");
  if (path === "/v1/admin/users" && request.method === "POST") {
    const username = typeof data.username === "string" ? data.username.trim().toLowerCase() : "";
    if (!/^[a-z0-9][a-z0-9_.-]{1,63}$/.test(username) || username === "owner" || username === "bearer") throw new HttpError(422, "Invalid or reserved username");
    const hash = await hashPassword(passwordValue(data.password));
    if (await env.DB.prepare("SELECT id FROM admin_users WHERE username=?").bind(username).first()) throw new HttpError(409, "Username exists");
    await env.DB.prepare("INSERT INTO admin_users (id,username,display_name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), username, typeof data.display_name === "string" ? data.display_name.slice(0, 100) : username, hash, data.role || "staff", stamp()).run();
    return Response.json({ ok: true }, { status: 201 });
  }
  if (path.startsWith("/v1/admin/users/") && request.method === "PUT") {
    const id = path.slice("/v1/admin/users/".length);
    const user = await env.DB.prepare("SELECT * FROM admin_users WHERE id=?").bind(id).first<User>();
    if (!user) throw new HttpError(404, "User not found");
    if (data.disabled !== undefined && typeof data.disabled !== "boolean") throw new HttpError(422, "Invalid disabled flag");
    if (user.username === "owner" && (data.disabled === true || data.role === "staff")) throw new HttpError(422, "Bootstrap owner must remain enabled and owner");
    const hash = data.password === undefined ? user.password_hash : await hashPassword(passwordValue(data.password));
    await env.DB.batch([
      env.DB.prepare("UPDATE admin_users SET password_hash=?,role=?,disabled=? WHERE id=?").bind(hash, data.role || user.role, data.disabled === undefined ? user.disabled : Number(data.disabled), id),
      env.DB.prepare("DELETE FROM admin_sessions WHERE user_id=?").bind(id),
    ]);
    return Response.json({ ok: true });
  }
  throw new HttpError(405, "Method not allowed");
}
