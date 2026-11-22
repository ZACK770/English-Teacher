import { type Env, HttpError } from "./env";

export async function sendPortalCode(env: Env, email: string, code: string) {
  if (!env.PORTAL_EMAIL) throw new HttpError(503, "שליחת המייל לא זמינה כרגע. נסו שוב מאוחר יותר.");
  await env.PORTAL_EMAIL.send({
    from: "noreply@speakcall.app",
    to: email,
    subject: "קוד כניסה לספיקול",
    text: `קוד כניסה: ${code}. יש להזין אותו באתר.\nהקוד תקף ל־10 דקות ולכניסה אחת בלבד. אין לשתף אותו.\nאם לא הוגשה בקשה לקוד, אפשר להתעלם מהמייל.`,
    html: `<div dir="rtl" lang="he"><p>קוד כניסה:</p><p dir="ltr" style="font-size:32px;letter-spacing:6px">${code}</p><p>יש להזין אותו באתר. הקוד תקף ל־10 דקות ולכניסה אחת בלבד. אין לשתף אותו.</p><p>אם לא הוגשה בקשה לקוד, אפשר להתעלם מהמייל.</p></div>`,
  });
}
