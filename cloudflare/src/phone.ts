export const HIDDEN_CALLER_MESSAGE = "שלום, הגעתם לספיקול. לא ניתן להשתמש בשירות ממספר חסוי. אנא התקשרו ממספר גלוי. תודה.";
export const CALL_FAILURE_MESSAGE = "מצטערים, אירעה תקלה טכנית. אנא נסו להתקשר שוב בעוד מספר דקות.";

export function visiblePhone(value: string): string | null {
  const raw = value.trim();
  if (!/^\+?[0-9 ()-]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("972")) digits = "0" + digits.slice(3);
  if (digits.length < 8 || digits.length > 15 || /^0+$/.test(digits)) return null;
  return digits;
}
