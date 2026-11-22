import { afterEach, describe, expect, it, vi } from "vitest";
import { SubscriptionPanel } from "../../src/components/portal/SubscriptionPanel";
import { portalRequest } from "../../src/components/portal/portalApi";

vi.mock("react", async importOriginal => ({
  ...await importOriginal(),
  useState: initial => [initial, vi.fn()],
  useEffect: vi.fn(),
}));
vi.mock("../../src/components/portal/portalApi", () => ({
  PortalError: class extends Error {},
  topics: [],
  portalRequest: vi.fn(),
}));

function accessControl(node) {
  if (!node || typeof node !== "object") return;
  if (node.props?.changeAccess) return node.props.changeAccess;
  return [node.props?.children].flat(Infinity).map(accessControl).find(Boolean);
}

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("subscription access refresh", () => {
  it.each([null, "2026-01-01"])("refreshes the CRM after a successful access change from %s", async access_suspended_at => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const sub = { id: "sub", access_suspended_at };
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(portalRequest).mockResolvedValue({ id: "sub", access_suspended_at: access_suspended_at ? null : "2026-02-01" });
    const panel = SubscriptionPanel({ token: "", customerId: "owner", subscriptions: [sub], manageAccess: true, onRefresh });
    await accessControl(panel)(sub);
    expect(portalRequest).toHaveBeenCalledWith(`/v1/admin/crm/subscriptions/sub/${access_suspended_at ? "restore" : "suspend"}`, "", {});
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("does not refresh after a rejected access change or cancelled confirmation", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const sub = { id: "sub", access_suspended_at: null };
    const onRefresh = vi.fn();
    vi.mocked(portalRequest).mockRejectedValue(new Error("offline"));
    const panel = SubscriptionPanel({ token: "", customerId: "owner", subscriptions: [sub], manageAccess: true, onRefresh });
    await accessControl(panel)(sub);
    expect(onRefresh).not.toHaveBeenCalled();
    vi.mocked(portalRequest).mockClear();
    vi.mocked(confirm).mockReturnValue(false);
    await accessControl(panel)(sub);
    expect(portalRequest).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("does not expose an access control without subscriptions or owner permission", () => {
    expect(accessControl(SubscriptionPanel({ token: "", customerId: "owner", subscriptions: [], manageAccess: true }))).toBeUndefined();
    expect(accessControl(SubscriptionPanel({ token: "", customerId: "owner", subscriptions: [{ id: "sub" }], manageAccess: false }))).toBeUndefined();
  });
});
