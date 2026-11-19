import { type Env, HttpError } from "./env";

export async function sendPortalCode(env: Env, email: string, code: string) {
  if (!env.PORTAL_EMAIL) throw new HttpError(503, "שליחת המייל לא זמינה כרגע. נסו שוב מאוחר יותר.");
  await env.PORTAL_EMAIL.send({
    from: "noreply@speakcall.app",
    to: email,
    subject: "קוד הכניסה שלך לספיקול",
    text: `קוד הכניסה שלך: ${code}. מזינים אותו באתר.\nהקוד תקף ל־10 דקות ולכניסה אחת בלבד. אין לשתף אותו.\nלא ביקשת קוד? אפשר להתעלם מהמייל.`,
    html: `<div dir="rtl" lang="he"><p>קוד הכניסה שלך:</p><p dir="ltr" style="font-size:32px;letter-spacing:6px">${code}</p><p>מזינים אותו באתר. הקוד תקף ל־10 דקות ולכניסה אחת בלבד. אין לשתף אותו.</p><p>לא ביקשת קוד? אפשר להתעלם מהמייל.</p></div>`,
  });
}
