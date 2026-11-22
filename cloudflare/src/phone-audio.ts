import type { IVRResponse } from "./pbx";

const recordings = new Map<string, string>([
  ["לבחירת מורה הקישו 1. לבחירת סוג השיעור 2. לחבילות ותשלום 3. להשארת הודעה 4. לחזרה 0.", "options-bae4d806ce46.wav"],
  ["לבחירת מורה הקישו 1. לבחירת סוג השיעור 2. לחבילות ותשלום 3. להשארת הודעה 4. לחזרה 0. לשירותים נוספים הקישו 6.", "options_all-975042e435c2.wav"],
  ["להמשך הקורס הקישו 1. לשיחה חופשית הקישו 2. לחזרה הקישו 0.", "school_mode-49941f446a4d.wav"],
  ["אין מורה זמין כרגע. לאפשרויות נוספות הקישו 9. לחזרה הקישו 0.", "school-c5a68023e149.wav"],
  ["לחבילות ותשלום הקישו 1. לשירות לקוחות הקישו 4. לחזרה הקישו 0.", "sales-7014ef55b643.wav"],
  ["השאירו הודעה לאחר הצליל. לסיום הקישו סולמית.", "service-fa198fa4f687.wav"],
  ["הודעתכם נשמרה, תודה. לחזרה הקישו 0. לסיום הקישו 1.", "thanks-4add3a38be81.wav"],
  ["הדקות לשיחות כבר נוצלו. לא נורא, ממשיכים: לבחירת מסלול הקישו 1. ללמידה הקישו 2. לתפריט הראשי הקישו 0.", "quota-3246887deb21.wav"],
  ["התרגומון אינו זמין כרגע. לשינוי שפה הקישו 9. לחזרה הקישו 0.", "translator-d19792035cb6.wav"],
  ["לאנגלית הקישו 1. לעברית 2. ליידיש 3. לערבית 4. לרוסית 5. לצרפתית 6. לזיהוי אוטומטי ותרגום עברית אנגלית הקישו 7. לחזרה הקישו 0.", "languages-f248a446966e.wav"],
  ["שלום, הגעתם לספיקול. לא ניתן להשתמש בשירות ממספר חסוי. אנא התקשרו ממספר גלוי. תודה.", "hidden_caller-84c1d772f23b.wav"],
]);

export function withRecordedAudio(result: IVRResponse, publicBaseUrl?: string): IVRResponse {
  if (!publicBaseUrl || !Array.isArray(result.files)) return result;
  const base = publicBaseUrl.replace(/\/$/, "");
  result.files = result.files.map((file: { text?: string }) => {
    const name = file.text && recordings.get(file.text.trim());
    return name ? { fileLink: `${base}/brand/phone/${name}`, fileName: name.replace(/\.wav$/, "") } : file;
  });
  return result;
}
