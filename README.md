# English Teacher — מורה קולית דרך טכנוליין

שרת מאובטח שמחבר ערוץ סטרימינג גולמי של טכנוליין אל Gemini Live ומפעיל מורה
קולית לאנגלית לתלמידת כיתה ח'. המורה מנהלת שיחה קצרה וטבעית, מתקנת טעויות
בעדינות, מתאימה את הרמה ושומרת תצפיות לימודיות קצרות בין שיעורים.

הפרויקט אינו מוצר רשמי של טכנוליין או Google.

## מה כלול

- WebSocket מאומת ב־Bearer עבור טכנוליין.
- אימות נפרד של מזהה הערוץ 2614d922d06b4f — הוא מזהה, לא סוד.
- תמיכה בפרוטוקול שנמדד: PCM16LE, מונו, 8kHz, מסגרת של 320 בתים בכל 20ms.
- המרה רציפה 8kHz → 16kHz עבור Gemini ו־24kHz → 8kHz עבור המרכזייה.
- שליחת אודיו חזרה בקצב קבוע וקטיעת תשובה כאשר התלמידה מתחילה לדבר.
- Gemini 3.8 Live כברירת מחדל, עם VAD מותאם לשיחת טלפון.
- SQLite למעקב התקדמות. תמלילים אינם נשמרים כברירת מחדל.
- בדיקות, Docker ו־Blueprint מוכן ל־Render.

## פריסה מהירה ב־Render

1. ב־Render בוחרים **New → Blueprint** ומחברים את המאגר הזה.
2. Render קורא את render.yaml ויוצר שירות בשם technoline-english-teacher.
3. מזינים רק את GEMINI_API_KEY כאשר Render מבקש אותו.
4. לאחר שהשירות עלה, בודקים:

   ~~~text
   https://<render-domain>/readyz
   ~~~

5. ב־Render פותחים Environment ומעתיקים את הערך שנוצר עבור
   TECHNOLINE_BEARER_SECRET.
6. בטכנוליין מגדירים:

   ~~~text
   WebSocket endpoint: wss://<render-domain>/v1/technoline/stream
   Authentication secret: הערך של TECHNOLINE_BEARER_SECRET
   Channel token: 2614d922d06b4f
   ~~~

אין כתובת wss מדויקת לפני ש־Render מסיים את הפריסה ומקצה דומיין.
הוראות מלאות נמצאות ב־[docs/deployment.md](docs/deployment.md).

## הפעלה מקומית

נדרש Python 3.12 ומעלה:

~~~bash
python -m venv .venv
pip install -e ".[test]"
cp .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8080
~~~

יש ליצור שני סודות שונים באורך 32 תווים לפחות:

~~~bash
python scripts/generate_secret.py
python scripts/generate_secret.py
~~~

שומרים אותם ב־.env תחת TECHNOLINE_BEARER_SECRET ו־ADMIN_BEARER_SECRET.
את מפתח Gemini שומרים רק במשתני הסביבה.

## דוח התקדמות

~~~bash
curl -H "Authorization: Bearer <ADMIN_BEARER_SECRET>" https://<render-domain>/v1/progress/student
~~~

הדוח כולל זמני תרגול, מספר תורות ותצפיות לפי מיומנות. המורה מקבלת בתחילת
השיחה הבאה תקציר פרטי וקצר של התצפיות הקודמות. אין לשים שם, מספר טלפון או
שם בית ספר בתוך STUDENT_ID.

## בדיקות

~~~bash
ruff check .
pytest -q
docker build -t technoline-english-teacher .
~~~

לבדיקת WebSocket לאחר פריסה:

~~~bash
TECHNOLINE_BEARER_SECRET=... python scripts/smoke_test.py wss://<render-domain>/v1/technoline/stream
~~~

הבדיקה פותחת חיבור אמיתי ל־Gemini ועלולה להיות מחויבת.

## פרטיות

- הקלטות אינן נשמרות.
- תמלילים אינם נשמרים אלא אם מפעילים במפורש STORE_TRANSCRIPTS=true.
- מספר המתקשר אינו מועבר לפרומפט ואינו נשמר בדוח.
- המורה מונחית לא לבקש שם מלא, כתובת, מוסד לימודים, סיסמאות או מספרי טלפון.

## רישיון

MIT
