import { QUOTA_EXTENSION_PATH } from "./pbx-paths";

export const FREE_TIER_TEXT = "שיעור פתיחה חד־פעמי, ולאחריו 2 שיחות התנסות קצרות בחודש";
export const MONTHLY_TERMS = "מנוי שנתי במחיר של 10 חודשים. המחיר נעול כל עוד המנוי פעיל. זמן שיחה שלא נוצל נצבר לחודש אחד בלבד. אפשר להקפיא עד חודשיים בשנה ולבטל בכל עת.";
export const MASTERY_GUARANTEE = "לא הגעת ל־70% שליטה באוצר המילים של המסלול לפי המדידה במערכת? מקבלים 3 חודשים נוספים ללא עלות.";
export const SCHOOL_FREE_POLICY = {
  enabled: true, product: "school" as const, opening_seconds: 420,
  free_calls_month: 2, free_call_seconds: 300, basic_enabled: false,
  blocked_extension: QUOTA_EXTENSION_PATH,
};

export const PRICING_PACKAGES = [
  { id: "school-step", name: "סטארט", product: "school" as const, billing: "monthly" as const, price_ils: 59, minutes: 60, sessions_per_week: 3, monthly_minutes: 60, validity_days: 30, max_call_minutes: 10, annual_price_ils: 590, recommended: false, tagline: "צעד ראשון לדיבור", active: true, phone_enabled: true, automated_purchase: false },
  { id: "school-pace", name: "סמול טוק", product: "school" as const, billing: "monthly" as const, price_ils: 119, minutes: 200, sessions_per_week: 7, monthly_minutes: 200, validity_days: 30, max_call_minutes: 15, annual_price_ils: 1190, recommended: false, tagline: "מתחילים לדבר באמת", active: true, phone_enabled: true, automated_purchase: false },
  { id: "school-fluent", name: "פרו", product: "school" as const, billing: "monthly" as const, price_ils: 199, minutes: 400, sessions_per_week: 7, monthly_minutes: 300, validity_days: 30, max_call_minutes: 20, annual_price_ils: 1990, recommended: true, tagline: "אימון יומי ארוך לקצב מהיר ותוצאות", active: true, phone_enabled: true, automated_purchase: false },
  { id: "school-foundations", name: "מקס", product: "school" as const, billing: "one_time" as const, price_ils: 690, minutes: 300, sessions_per_week: 7, monthly_minutes: 150, max_payments: 6, validity_days: 180, duration_months: 6, max_call_minutes: 20, anchor_price_ils: 1194, recommended: false, tagline: "אימון בכל יום לבניית בסיס חזק", active: true, phone_enabled: true, automated_purchase: false },
  { id: "school-mastery", name: "מאסטר", product: "school" as const, billing: "one_time" as const, price_ils: 1490, minutes: 300, sessions_per_week: 7, monthly_minutes: 150, max_payments: 12, validity_days: 365, duration_months: 12, max_call_minutes: 20, anchor_price_ils: 2388, recommended: false, tagline: "אימון בכל יום עם אוצר מילים מתקדם ותחום לבחירה, עד שליטה וביטחון", active: true, phone_enabled: true, automated_purchase: false },
  { id: "school-topup", name: "תוספת זמן שיחה", product: "school" as const, billing: "one_time" as const, price_ils: 39, minutes: 60, validity_days: 30, max_call_minutes: 15, recommended: false, tagline: "רכישה חד־פעמית, גם ללא מנוי", active: true, phone_enabled: true, automated_purchase: true },
  { id: "pkg_translator_free", name: "תרגומון עסקי · 600 דקות", product: "translator" as const, billing: "prepaid" as const, price_ils: 420, minutes: 600, validity_days: 90, max_call_minutes: 5, recommended: false, tagline: "תרגום בקו ובאתר", active: true, phone_enabled: true, automated_purchase: true },
];

export function canPurchaseAutomatically(pkg: { billing?: string; automated_purchase?: boolean; duration_months?: number }): boolean {
  return pkg.automated_purchase !== false && !pkg.duration_months && !["monthly", "yearly"].includes(pkg.billing ?? "prepaid");
}

export function replaceSchoolPackages<T extends { product: string }>(existing: T[]) {
  return [...PRICING_PACKAGES.filter(p => p.product === "school"), ...existing.filter(p => p.product !== "school")];
}
