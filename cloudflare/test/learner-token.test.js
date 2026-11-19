import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearLearnerToken, readLearnerToken, saveLearnerToken } from "../../src/components/portal/learnerToken";

let initialToken, portalRequest, resumeLearnerSession;
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
beforeAll(async () => {
  vi.stubGlobal("location", { pathname: "/learn", hash: "" });
  ({ initialToken, portalRequest, resumeLearnerSession } = await import("../../src/components/portal/portalApi"));
});
beforeEach(() => {
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("sessionStorage", storage());
  vi.stubGlobal("location", { pathname: "/learn", hash: "" });
  vi.stubGlobal("history", { replaceState: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ customer: { id: "learner" } }), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

describe("persistent learner authentication", () => {
  it("persists across a new tab and refresh", () => {
    saveLearnerToken("durable-token");
    vi.stubGlobal("sessionStorage", storage());
    expect(initialToken()).toBe("durable-token");
    expect(initialToken()).toBe("durable-token");
  });
  it("migrates a legacy session token and prefers the durable token", () => {
    sessionStorage.setItem("learnerToken", "legacy-token");
    expect(initialToken()).toBe("legacy-token");
    expect(localStorage.getItem("learnerToken")).toBe("legacy-token");
    expect(sessionStorage.getItem("learnerToken")).toBeNull();
    sessionStorage.setItem("learnerToken", "older-token");
    expect(readLearnerToken()).toBe("legacy-token");
    expect(sessionStorage.getItem("learnerToken")).toBeNull();
  });
  it("stores invite tokens durably and removes only the token from a checkout link", () => {
    location.hash = "#" + "a".repeat(40);
    location.search = "?plan=starter";
    expect(initialToken()).toBe("a".repeat(40));
    expect(localStorage.getItem("learnerToken")).toBe("a".repeat(40));
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/learn?plan=starter");
  });
  it("keeps an existing token when the fragment is malformed", () => {
    saveLearnerToken("durable-token");
    location.hash = "#%ZZ";
    expect(initialToken()).toBe("durable-token");
  });
  it("does not call /me without a token", async () => {
    expect(await resumeLearnerSession()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("validates the token through /me before resuming", async () => {
    saveLearnerToken("durable-token");
    expect(await resumeLearnerSession()).toBe(true);
    expect(fetch).toHaveBeenCalledWith("/v1/portal/me", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer durable-token" }) }));
  });
  it("clears an expired token on a 401, including non-JSON responses", async () => {
    saveLearnerToken("expired-token");
    sessionStorage.setItem("learnerToken", "legacy-token");
    fetch.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    expect(await resumeLearnerSession()).toBe(false);
    expect(readLearnerToken()).toBe("");
  });
  it.each([403, 429, 500])("retains the token on HTTP %s", async status => {
    saveLearnerToken("durable-token");
    fetch.mockResolvedValue(new Response("{}", { status }));
    expect(await resumeLearnerSession()).toBe(false);
    expect(readLearnerToken()).toBe("durable-token");
  });
  it("retains the token after a network failure", async () => {
    saveLearnerToken("durable-token");
    fetch.mockRejectedValue(new Error("offline"));
    expect(await resumeLearnerSession()).toBe(false);
    expect(readLearnerToken()).toBe("durable-token");
  });
  it("does not clear a newer token when an old request fails", async () => {
    saveLearnerToken("new-token");
    fetch.mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(portalRequest("/v1/portal/me", "old-token")).rejects.toMatchObject({ status: 401 });
    expect(readLearnerToken()).toBe("new-token");
  });
  it("does not clear learner authentication when a login challenge is rejected", async () => {
    saveLearnerToken("durable-token");
    fetch.mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(portalRequest("/v1/portal/auth/email/verify", "", {})).rejects.toMatchObject({ status: 401 });
    expect(readLearnerToken()).toBe("durable-token");
  });
  it("does not resume after explicit logout while validation is pending", async () => {
    saveLearnerToken("durable-token");
    let resolve;
    fetch.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = resumeLearnerSession();
    clearLearnerToken();
    resolve(new Response("{}"));
    expect(await pending).toBe(false);
  });
  it("clears both storage locations on explicit logout", () => {
    saveLearnerToken("durable-token");
    sessionStorage.setItem("learnerToken", "legacy-token");
    clearLearnerToken();
    expect(localStorage.getItem("learnerToken")).toBeNull();
    expect(sessionStorage.getItem("learnerToken")).toBeNull();
  });
});
