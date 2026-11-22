export const PAYMENT_FAILED_MESSAGE = "התשלום לא הצליח. אפשר להשתמש בכרטיס אשראי אחר או לפנות לתמיכה";

export function customerPackageName(name: string) {
  return name === "תוספת דקות" ? "תוספת תרגול" : name.replace(/ · \d+ דקות$/, "");
}
