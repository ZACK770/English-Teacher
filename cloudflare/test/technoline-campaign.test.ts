import { describe, expect, it } from "vitest";
import { campaignExternalId } from "../src/technoline-campaign";

describe("Technoline campaign external IDs", () => {
  it.each(["", "request-1", "a".repeat(64)])("bounds and randomizes IDs for reference %s", reference => {
    const first = campaignExternalId(reference);
    const second = campaignExternalId(reference);
    expect(first).toMatch(/^[a-z0-9-]*-[a-f0-9]{32}$/);
    expect(first.startsWith(reference.slice(0, 17) + "-")).toBe(true);
    expect(first.length).toBeLessThanOrEqual(50);
    expect(second).not.toBe(first);
  });
});
