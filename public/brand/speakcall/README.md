# SpeakCall — חבילת המותג הנבחרת

אייזיק בחר בחלופה 1: C שהיא גם בועת דיבור. צורת האות נשמרה; הצבע הראשי קובלט והזנב טורקיז. האנגלית היא הלוגו הראשי; העברית משלימה עם אותו סמל.

## הטמעה
- להעתיק את החבילה אל public/brand/speakcall/ (ללא תיקיות עוטפות).
- ראשי: logo-en.svg. להציג למשל ברוחב 174–220px; גובה אוטומטי, ללא מתיחה.
- עברית: logo-he.svg. גרסאות reverse מיועדות לרקע כהה; black/white לשימוש בצבע אחד.
- symbol.svg לסמל מערכת; app-icon.svg למשטח ריבועי. אין להוסיף אייקון נפרד ליד הלוגו האנגלי — ה־C כבר משולבת בו.
- favicon.svg או favicon.ico; לשמור type נכון. favicon-16/32/48.png הם רסטרים מקוריים, לא דוגמאות מוגדלות.
- apple-touch-icon.png בגודל 180px. site.webmanifest מכוון לנתיבי /brand/speakcall/; אם משנים מיקום, לשנות נתיבים בהתאם.
- כל האותיות מומרות למסלולים. אין תלות בפונטים, סקריפטים או משאבים חיצוניים.

## דוגמה ל־head
<link rel="icon" type="image/svg+xml" href="/brand/speakcall/favicon.svg">
<link rel="alternate icon" href="/brand/speakcall/favicon.ico">
<link rel="apple-touch-icon" href="/brand/speakcall/apple-touch-icon.png">
<link rel="manifest" href="/brand/speakcall/site.webmanifest">

## השפה החזותית והתנועה
- motif-dialogue.svg: שני צדדי שיחה. motif-orbit.svg: נוכחות הקול. motif-pattern.svg: רקע דקורטיבי.
- symbol-breathe.svg כולל נשימה עדינה במחזור 4 שניות ומכבד prefers-reduced-motion. מתאים לאיור גדול, לא ללוגו ניווט, לפאביקון או ללחצנים.
- לחלופין brand.css מספק .speakcall-breathe לאלמנט חזותי, עם אותה התאמה להפחתת תנועה. לא לשלב את שתי האנימציות על אותו אלמנט.
- אין לבצע היפוך של הלוגו או הסמל הראשי. כיוונים מסובבים נמצאים רק במוטיבים הדקורטיביים שסופקו.
- אלמנט דקורטיבי: alt="". לוגו מקשר לבית: alt="SpeakCall — עמוד הבית".

## צבעים
Ink #172D36; Cobalt #3156D8; Teal #148F95; Paper #F7F8F3; Ice #E7EDFF; Mint #DDF3ED.
טורקיז הוא גוון ליווי גרפי, לא צבע לטקסט קטן על לבן. למסרים וכפתורים להשתמש בדיו/קובלט ולוודא ניגודיות בהקשר.

## ריווח
לא להסיר את הרווח הפנימי שבקבצים. להשאיר מסביב לפחות גובה של חצי אות קטנה כשיש טקסט או גבול סמוך. גודל מינימלי מומלץ ללוגו המלא: 132px רוחב; למטה מזה להשתמש בסמל בלבד.

הסמלים מקוריים. אותיות מבוססות Manrope ו־Heebo (SIL Open Font License).
החבילה לא נפרסה בסשן הלוגו; הפריסה שייכת לסשן דף הנחיתה.
