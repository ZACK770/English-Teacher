import { type Env, HttpError } from "./env";

export async function sendPortalCode(env: Env, email: string, code: string) {
  if (!env.PORTAL_EMAIL) throw new HttpError(503, "שליחת המייל לא זמינה כרגע. נסו שוב מאוחר יותר.");
  await env.PORTAL_EMAIL.send({
    from: "noreply@speakcall.app",
    to: email,
    subject: `קוד הכניסה שלך ל-SpeakCall: ${code}`,
    text: `קוד הכניסה שלך ל-SpeakCall הוא ${code}.\nהקוד תקף ל-10 דקות ולכניסה אחת בלבד. אין לשתף אותו.\nאם לא ביקשת קוד, אפשר להתעלם מהמייל.`,
    html: `<div dir="rtl" lang="he"><h1>ברוכים הבאים ל-SpeakCall</h1><p>קוד הכניסה שלך:</p><p dir="ltr" style="font-size:32px;letter-spacing:6px">${code}</p><p>הקוד תקף ל-10 דקות ולכניסה אחת בלבד. אין לשתף אותו.</p><p>אם לא ביקשת קוד, אפשר להתעלם מהמייל.</p></div>`,
  });
}
