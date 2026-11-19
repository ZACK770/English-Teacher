import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canPurchaseAutomatically, FREE_TIER_TEXT, MONTHLY_TERMS, PRICING_PACKAGES, replaceSchoolPackages, SCHOOL_FREE_POLICY } from "../../src/pricing";
import { INITIAL_ACCESS_POLICIES, INITIAL_PACKAGES } from "../../src/store/initialData";

afterEach(() => vi.unstubAllGlobals());

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

  it("renders approved Hebrew terms, anchors, and representative-only signup links", async () => {
    vi.stubGlobal("location", { pathname: "/english/" });
    const { SpeakoolLanding } = await import("../../src/components/portal/SpeakoolLanding");
    const html = renderToStaticMarkup(createElement(SpeakoolLanding));
    expect(html).toContain(FREE_TIER_TEXT);
    expect(html).toContain(MONTHLY_TERMS);
    for (const pkg of PRICING_PACKAGES) expect(html).toContain(pkg.name);
    expect(html).toContain("1,194");
    expect(html).toContain("2,388");
    expect(html).toContain("לעומת מנוי שוטף לאותה תקופה");
    expect(html).toContain("3 חודשים נוספים ללא עלות");
    expect(html.match(/href="\/english\/join"/g)).toHaveLength(5);
    expect(html.match(/מומלץ/g)).toHaveLength(2);
    expect(html).not.toContain("20 דקות מתנה");
    expect(html).not.toContain("₪220");
  });
});
