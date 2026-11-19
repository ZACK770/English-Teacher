import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canPurchaseAutomatically, FREE_TIER_TEXT, MONTHLY_TERMS, PRICING_PACKAGES, replaceSchoolPackages, SCHOOL_FREE_POLICY } from "../../src/pricing";
import { INITIAL_ACCESS_POLICIES, INITIAL_PACKAGES } from "../../src/store/initialData";

describe("site and dashboard pricing", () => {
  it("replaces cached school offers without changing translator records", () => {
    const translator = { id: "translator-existing", product: "translator", price_ils: 420, minutes: 600 };
    const school = PRICING_PACKAGES.filter(p => p.product === "school");
    expect(replaceSchoolPackages([{ id: "old-school", product: "school" }, translator])).toEqual([...school, translator]);
    expect(replaceSchoolPackages([])).toEqual(school);
  });

  it("uses the same catalog and free school policies in dashboard defaults", () => {
    expect(INITIAL_PACKAGES).toEqual(PRICING_PACKAGES);
    for (const id of ["maya-child", "alex-adult", "shochi-robot"]) expect(INITIAL_ACCESS_POLICIES[id]).toMatchObject(SCHOOL_FREE_POLICY);
    expect(INITIAL_PACKAGES.filter(canPurchaseAutomatically).map(p => p.id)).toEqual(["school-topup", "pkg_translator_free"]);
    expect(canPurchaseAutomatically({ billing: "monthly", automated_purchase: true })).toBe(false);
    expect(canPurchaseAutomatically({ billing: "yearly" })).toBe(false);
    expect(canPurchaseAutomatically({ billing: "one_time", duration_months: 6 })).toBe(false);
  });

  it("binds the landing to shared terms and representative-only signup links", () => {
    const source = readFileSync(new URL("../../src/components/portal/SpeakoolLanding.tsx", import.meta.url), "utf8");
    expect(source).toContain("{FREE_TIER_TEXT}");
    expect(source).toContain("{MONTHLY_TERMS}");
    expect(source).toContain("{MASTERY_GUARANTEE}");
    expect(source).toContain("לעומת מנוי שוטף לאותה תקופה");
    expect(source.match(/href=\{join\}/g)).toHaveLength(2);
    expect(source.match(/מומלץ/g)).toHaveLength(2);
    expect(source).not.toContain("20 דקות מתנה");
    expect(source).not.toContain("₪220");
    expect(FREE_TIER_TEXT).toContain("10 דקות");
    expect(MONTHLY_TERMS).toContain("₪29");
    expect(PRICING_PACKAGES.filter(p => p.anchor_price_ils).map(p => p.anchor_price_ils)).toEqual([1194, 2388]);
  });
});
