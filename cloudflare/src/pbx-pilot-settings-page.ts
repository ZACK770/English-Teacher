import { DEFAULT_TURN_TUNING } from "./turn-tuning";
const html = `<!doctype html>
<html lang="he" dir="rtl">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>מעבדת הקול של ספיקול</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#f6f8fa;color:#243640;font:14px system-ui,sans-serif}
main{max-width:1600px;margin:auto;padding:0 2px 16px}main>header{display:none}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}
h1{font-size:clamp(1.7rem,4vw,2.5rem);margin:0}h2{font-size:1.2rem;margin:0 0 12px}
a{color:#12604d}.layout{display:grid;grid-template-columns:minmax(260px,1fr) minmax(0,1.8fr);gap:16px}
section{min-width:0;background:white;border:1px solid #e2e8ec;border-radius:16px;padding:20px;margin-bottom:16px;box-shadow:0 3px 12px #163b4a04}
label{display:block;margin:10px 0 5px;font-weight:600}
select,input,textarea,button{font:inherit}select,input:not([type=checkbox]),textarea{display:block;width:100%;background:#fff;color:inherit;padding:8px;border:1px solid #a7bdb6;border-radius:7px}
textarea{min-height:72px;resize:vertical}
#preview-language[hidden],#preview-language-label[hidden],#preview-tts-model[hidden],#preview-tts-model-label[hidden]{display:none}
button{background:#136150;color:#fff;border:0;border-radius:7px;padding:8px 13px;margin:7px 0;cursor:pointer}
button.secondary{background:#e6efec;color:#164236}button:disabled{opacity:.5;cursor:default}
.line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:12px 0}
.metrics div{background:#eaf3ef;border-radius:8px;padding:9px;font-size:.85rem}
.metrics b{display:block;font-size:1rem;margin-top:4px;overflow-wrap:anywhere}
.status{min-height:1.4em;color:#42615a;font-size:.9rem}
.feed{max-height:340px;overflow:auto;padding:9px;background:#f4f7f6;border-radius:8px;overflow-wrap:anywhere}
.feed p{margin:6px 0;white-space:pre-wrap}
.log{font-size:.88rem;margin-top:10px}
audio{width:100%;margin-top:8px}
#comparison{white-space:pre-line}#turn-metrics{display:block;padding:12px;background:#eaf3ef;border-radius:10px}
fieldset{border:1px solid #e2e8ec;border-radius:12px;margin:16px 0;padding:14px}fieldset:disabled{opacity:.55}legend{font-weight:700}output{float:left;color:#147d72;font-variant-numeric:tabular-nums}input[type=range]{accent-color:#147d72;padding:4px!important;direction:ltr}fieldset .status{margin:4px 0 14px;font-size:12px}
[hidden]{display:none!important}.layout{display:block}.channel-shell,.workspace-head{padding:18px 22px}.channel-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.muted{font-size:13px;color:#657583;margin:6px 0 12px}.eyebrow{font-size:12px;font-weight:700;color:#147d72;margin-bottom:5px}.channel-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(142px,1fr));gap:12px}.channel-card{display:flex;flex-direction:column;align-items:flex-start;gap:5px;text-align:right;background:#f8fafb;color:#243640;border:1px solid #e2e8ec;padding:15px;border-radius:12px;margin:0}.channel-card[aria-pressed="true"]{background:#e6f4ef;border:2px solid #147d72;padding:14px;color:#125c4d}.channel-card strong{font-size:16px}.channel-card small{color:#657583}.tab-bar{display:flex;flex-wrap:wrap;gap:8px;border-bottom:1px solid #e2e8ec;margin:12px 0 -18px;padding-bottom:12px}.tab-bar button{background:#f0f4f3;color:#334c45;margin:0;border-radius:8px;padding:9px 16px}.tab-bar button[aria-selected="true"]{background:#136150;color:white}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.input-action{display:flex;gap:8px;align-items:center}.input-action button{white-space:nowrap}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:right;padding:12px;border-bottom:1px solid #e2e8ec;white-space:nowrap}th{background:#f6f8fa;color:#526573}#channel-status:empty,#access:empty{display:none}#create-panel{margin-top:15px;padding:14px;background:#f6f8fa;border-radius:10px}#channel-connect-panel,#channel-teacher-panel,#channel-preview-panel{max-width:980px;margin-inline:auto}textarea{line-height:1.5}.workspace-head h2{font-size:22px}.workspace-head .muted{margin:0}.channel-top h2{margin:0}
@media(max-width:780px){.layout{grid-template-columns:1fr}.form-grid{grid-template-columns:1fr}main{padding:8px}}
</style>
<main>
<header><h1>מעבדת הקול של ספיקול</h1><a href="/dashboard">ממשק הניהול</a></header>
<div id="access" class="status" role="status"></div>
<section class="channel-shell"><div class="channel-top"><div><h2>מנהל ערוצי הקול</h2><p class="muted">בחר ערוץ כדי לנהל את החיבור, המורה והבדיקות שלו.</p></div><button class="secondary" id="toggle-create">+ ערוץ חדש</button></div><div id="channel-cards" class="channel-cards" aria-label="ערוצים"></div><div id="create-panel" hidden><div class="form-grid"><div><label for="new-channel-name">שם הערוץ</label><input id="new-channel-name" maxlength="60"></div><div><label for="new-channel-id">מזהה באנגלית</label><input id="new-channel-id" dir="ltr" maxlength="40" placeholder="yiddish-test"></div></div><button id="create-channel">צור ערוץ</button></div><p id="channel-status" class="status"></p></section>
<section class="workspace-head"><div class="eyebrow">הערוץ הנבחר</div><h2 id="active-channel-title">יידיש</h2><p id="active-channel-description" class="muted"></p><nav id="channel-tabs" class="tab-bar" aria-label="מסכי הערוץ"></nav></section>
<div id="yiddish-panel" hidden>
<section id="channel-connect-panel"><h2>חיבור לטלפון ולספקים</h2><p class="muted">הפרטים נשמרים לערוץ הנבחר בלבד. אין צורך בפריסה מחדש.</p><label for="yiddish-wss">כתובת WSS לטכנוליין</label><div class="input-action"><input id="yiddish-wss" dir="ltr" readonly><button id="copy-yiddish-wss" class="secondary">העתק</button></div><label for="yiddish-channel-token">מזהה הערוץ בטכנוליין (token)</label><input id="yiddish-channel-token" type="password" autocomplete="off"><label for="yiddish-speech-key">מפתח API של Yiddish Tools</label><input id="yiddish-speech-key" type="password" autocomplete="off"><p class="muted">המפתח שהעתקת מאתר Yiddish Tools. הוא משמש להקראה ולתמלול.</p><label for="channel-inworld-key">מפתח Inworld (כאשר נבחר Inworld)</label><input id="channel-inworld-key" type="password" autocomplete="off"><label for="channel-google-key">מפתח Google Cloud Text-to-Speech (כאשר נבחר Google)</label><input id="channel-google-key" type="password" autocomplete="off"><label for="yiddish-model-key">מפתח OpenRouter</label><input id="yiddish-model-key" type="password" autocomplete="off"><p class="muted">אפשר להשאיר ריק אם מפתח השרת תקין. שדה ריק אינו מוחק ערך שמור.</p><button id="model-status-check" class="secondary">בדוק חיבור ומגבלת OpenRouter</button><p id="model-status-result" class="status"></p><div class="line"><button id="channel-connect-save" disabled>שמור חיבורים</button><button class="secondary" id="go-channel-preview">לבדיקת הקול ←</button></div><p id="channel-connect-status" class="status" role="status"></p></section>
<section id="channel-teacher-panel" hidden><h2>המורה בטלפון</h2><p class="muted">השינויים יחולו בחיוג הבא לערוץ הנבחר.</p><div class="form-grid"><div><label for="yiddish-model">מודל המורה · OpenRouter</label><select id="yiddish-model"><option value="google/gemini-2.5-flash">Gemini 2.5 Flash</option><option value="openai/gpt-4.1-mini">GPT-4.1 mini</option><option value="qwen/qwen3-235b-a22b-2507">Qwen 3 235B</option></select></div><div><label for="channel-speech">מנוע הקראה בטלפון</label><select id="channel-speech"><option value="yiddish">Yiddish Tools</option><option value="inworld">Inworld</option><option value="google">Google Standard</option></select><label for="yiddish-voice">קול בטלפון</label><select id="yiddish-voice"></select><div id="channel-inworld-options" hidden><label for="channel-inworld-language">שפת Inworld</label><select id="channel-inworld-language"><option value="auto">אוטומטי</option><option value="ydd">יידיש מזרחית</option><option value="yi">יידיש כללית</option><option value="he">עברית</option><option value="en">אנגלית</option></select><label for="channel-inworld-model">מודל הקראה</label><select id="channel-inworld-model"><option value="inworld-tts-2-flash">TTS-2 Flash</option><option value="inworld-tts-2">TTS-2</option></select></div></div></div><label for="channel-stt">זיהוי דיבור של התלמיד (STT)</label><select id="channel-stt"><option value="yiddish-tools">Yiddish Tools · תמלול יידיש, אטי</option><option value="gemini">Gemini 2.5 Flash · עברית ויידיש (ניסיוני)</option></select><p class="muted">בחירה זו משנה את התמלול בלבד, לא את הקול או את מודל המורה.</p><label for="yiddish-prompt">הנחיות המורה</label><textarea id="yiddish-prompt" maxlength="6000" rows="7"></textarea><label for="yiddish-greeting">משפט פתיחה</label><textarea id="yiddish-greeting" maxlength="500"></textarea><label for="channel-interruption">קטיעות בטלפון</label><select id="channel-interruption"><option value="adaptive">מאוזן · השהיה ובדיקת צליל</option><option value="observe">תצפית בלבד</option><option value="legacy">קטיעה מיידית לפי עוצמה</option><option value="adaptive_clear">השהיה וקטיעה + ניקוי בטכנוליין (ניסיוני)</option></select><fieldset><legend>כוונון זיהוי דיבור</legend><p class="muted">המחוונים זהים ל־888. בתמלול לפי תור האימות נשען על עוצמת ומשך הצליל, ללא מילים חלקיות.</p><label for="channel-energyThreshold">סף עוצמה <output id="channel-energyThreshold-value"></output></label><input id="channel-energyThreshold" type="range" min="400" max="4000" step="100"><label for="channel-minSoundMs">משך צליל לפני השהיה <output id="channel-minSoundMs-value"></output></label><input id="channel-minSoundMs" type="range" min="200" max="1200" step="50"><label for="channel-resumeSilenceMs">שקט לפני חזרה לדיבור <output id="channel-resumeSilenceMs-value"></output></label><input id="channel-resumeSilenceMs" type="range" min="200" max="1000" step="20"><button class="secondary" id="channel-reset-tuning">חזור לערכים המומלצים</button></fieldset><label for="channel-endpoint">שתיקה לזיהוי סוף תור</label><select id="channel-endpoint"><option value="500">500 ms</option><option value="700">700 ms</option><option value="1000">1,000 ms</option><option value="1500">1,500 ms</option></select><label class="line"><input id="channel-capture" type="checkbox"> שמור תמלול של שיחות הבדיקה בהיסטוריית הערוץ</label><div class="line"><button id="yiddish-save" disabled>שמור הגדרות מורה</button><button class="secondary" id="channel-rollback" disabled>חזור לגרסה הקודמת</button><button class="secondary" id="channel-export">יצא תמהיל</button></div><p id="teacher-status" class="status" role="status"></p></section>
<section id="channel-preview-panel" hidden><h2>בדיקת הקראה בדפדפן</h2><p class="muted">הבדיקה משתמשת במפתחות השמורים בערוץ הזה. היא לא משנה את קול הטלפון עד שתבחר לשמור אותו.</p><label for="channel-test-speech">ספק הקראה לבדיקה</label><select id="channel-test-speech"><option value="yiddish">Yiddish Tools</option><option value="inworld">Inworld</option><option value="google">Google Standard</option></select><label for="channel-test-voice">קול להשוואה</label><select id="channel-test-voice"></select><label for="channel-sample">טקסט להקראה</label><textarea id="channel-sample" maxlength="1000">שלום עליכם! ווי גייט עס דיר היינט?</textarea><div class="line"><button id="yiddish-listen">הפק ונגן שמע</button><button id="choose-phone-voice" class="secondary">בחר קול זה לטלפון</button></div><p id="yiddish-status" class="status" role="status"></p><audio id="channel-audio" controls preload="metadata" hidden></audio><a id="channel-download" download="speakcall-yiddish.wav" hidden>הורד קובץ WAV</a><hr><h2>השוואת תמלול</h2><p class="muted">בחר הקלטה של עד 12 שניות בדיבור בעברית, ביידיש או בשתיהן. שני המנועים יקבלו אותו שמע טלפוני.</p><label for="stt-sample-file">קובץ שמע</label><input type="file" accept="audio/*,.wav,.mp3" id="stt-sample-file"><button id="stt-compare">השווה תמלול וזמן תגובה</button><div id="stt-compare-result" class="feed" aria-live="polite"></div></section>
<section id="channel-calls-panel" hidden><div class="channel-top"><h2>שיחות בערוץ</h2><button id="reload-channel-calls" class="secondary">רענן</button></div><p id="channel-calls-status" class="status"></p><div class="table-scroll"><table><thead><tr><th>זמן</th><th>משך</th><th>שמע ראשון בפתיחה</th><th>זמן תגובה לתלמיד</th><th>תמלול / מודל / קול</th><th>קול</th><th>תורים</th><th>סיום</th></tr></thead><tbody id="channel-calls-rows"></tbody></table></div><label for="channel-call-select">שיחה להצגה</label><select id="channel-call-select"><option value="">עקוב אחרי השיחה האחרונה</option></select><div class="metrics"><div>מודל וקול<b id="channel-call-config">—</b></div><div>טוקנים · קלט / פלט<b id="channel-call-tokens">—</b></div><div>עלות בדולרים<b id="channel-call-cost">—</b></div><div>שמע ראשון בפתיחה<b id="channel-call-latency">—</b></div></div><p id="channel-cost-detail" class="muted"></p><h2>מדדי קטיעה ותגובה</h2><div id="channel-turn-metrics" class="metrics"></div><p id="channel-call-tuning" class="muted"></p><label for="channel-call-compare">השווה מול שיחה</label><select id="channel-call-compare"><option value="">בחר שיחה שהסתיימה</option></select><div id="channel-comparison" class="status"></div><h2>תמלול</h2><div id="channel-transcript" class="feed" role="log"></div><h2 style="margin-top:16px">אירועים</h2><div id="channel-events" class="feed log" role="log"></div><p class="muted">תמלול ומדדים מפורטים נשמרים משיחות חדשות בלבד. אין ערבוב עם היסטוריית שלוחה 888.</p></section>
</div>
<div class="layout" id="english-layout" hidden>
<div>
<section id="english-settings-panel" hidden>
<h2>הגדרות לחיוג הבא ל־888</h2>
<label for="model">מודל המורה</label><select id="model" disabled></select>
<label for="speech">מנוע הקראה בטלפון</label>
<select id="speech" disabled><option value="inworld">Inworld</option><option value="google">Google Standard</option></select>
<label for="voice">קול בטלפון</label><select id="voice" disabled></select>
<div id="phone-google" hidden>
<label for="phone-google-key">מפתח Google לטלפון</label>
<input id="phone-google-key" type="password" autocomplete="off" placeholder="הדבק פעם אחת את מפתח Google Cloud">
</div>
<label for="interruption">קטיעות בטלפון</label>
<select id="interruption" disabled>
<option value="adaptive">מאוזן · זיהוי מילה או צליל רציף לפי המחוונים</option>
<option value="observe">תצפית בלבד עד סוף תור</option>
<option value="legacy">קטיעה מיידית לפי עוצמה</option>
<option value="adaptive_clear">השהיה וחידוש + ניקוי בטכנוליין (ניסיוני)</option>
</select>
<fieldset id="tuning-fields" disabled>
<legend>כוונון זיהוי דיבור</legend>
<p class="status">חל על מצבי הקטיעה המאוזנים בתמהיל. שינוי חל בחיוג הבא ל־888 לאחר שמירה; לשלוחה 1 יש להחיל את התמהיל השמור.</p>
<label for="energyThreshold">סף עוצמה <output id="energyThreshold-value"></output></label>
<input id="energyThreshold" type="range" min="400" max="4000" step="100" aria-describedby="energy-help">
<p id="energy-help" class="status">גבוה יותר מתעלם מרעשים חלשים, אך עלול לפספס דיבור חלש. יחידות עוצמה דיגיטליות, לא דציבלים.</p>
<label for="minSoundMs">משך צליל לפני השהיה <output id="minSoundMs-value"></output></label>
<input id="minSoundMs" type="range" min="200" max="1200" step="50" aria-describedby="sound-help">
<p id="sound-help" class="status">ארוך יותר מסנן נשיפות ורעשים קצרים. מילה שזוהתה בתמלול יכולה לקטוע מוקדם יותר.</p>
<label for="resumeSilenceMs">שקט לפני חזרה לדיבור <output id="resumeSilenceMs-value"></output></label>
<input id="resumeSilenceMs" type="range" min="200" max="1000" step="20" aria-describedby="resume-help">
<p id="resume-help" class="status">זמן ההמתנה אחרי שהרעש נחלש, אם לא זוהתה מילה. נמוך יותר חוזר מהר. ההשהיה מוגבלת בכל מקרה ל־1,100 מילישניות.</p>
<button id="reset-tuning" class="secondary" type="button">חזור לערכים המומלצים</button>
</fieldset>
<label for="endpoint">שתיקה לזיהוי סוף תור</label>
<select id="endpoint" disabled><option value="">לפי הגדרת המורה</option><option value="500">500 ms</option><option value="700">700 ms</option><option value="1000">1,000 ms</option><option value="1500">1,500 ms</option></select>
<p class="status">שתיקה ארוכה יותר מאפשרת לחשוב באמצע משפט, אך מאריכה את ההמתנה לתשובת המורה.</p>
<label class="line"><input id="capture" type="checkbox" disabled> תמלול שיחות הבדיקה והצגתן בהיסטוריה</label>
<div class="line"><button id="save" disabled>שמור לחיוג הבא</button><button class="secondary" id="rollback" disabled>חזור לגרסה הקודמת</button></div>
<div id="settings-status" class="status" role="status"></div>
<button class="secondary" id="export" disabled>יצא תמהיל שמור לשלוחה 1</button>
<div id="export-status" class="status" role="status"></div>
<div id="handoff" hidden>
<label for="handoff-data">תמהיל להעברה למתכנת</label>
<textarea id="handoff-data" readonly dir="ltr" rows="8"></textarea>
<button class="secondary" id="copy-handoff">העתק תמהיל</button>
<button class="secondary" id="download-handoff">הורד JSON</button>
</div>
</section>
<section id="school-panel" hidden>
<h2>מורה בשלוחה 1</h2>
<p id="school-status" class="status" role="status"></p>
<button id="school-promote" disabled>החל את התמהיל השמור על שלוחה 1</button>
<button id="school-gemini" class="secondary" disabled>חזור ל־Gemini Live</button>
</section>
<section id="english-preview-panel" hidden>
<h2>בדיקה בדפדפן · שלוחה 888</h2>
<label for="mode">מה לבדוק</label>
<select id="mode"><option value="model">תשובת מודל · OpenRouter</option><option value="inworld">קול · Inworld</option><option value="google">קול · Google Standard</option></select>
<label for="preview-choice" id="choice-label">מודל</label><select id="preview-choice"></select>
<label for="preview-language" id="preview-language-label" hidden>שפת ההקראה (לבדיקה בלבד)</label>
<select id="preview-language" hidden><option value="auto">זיהוי אוטומטי</option><option value="ydd">יידיש מזרחית (ydd)</option><option value="yi">יידיש כללית (yi)</option><option value="he">עברית</option><option value="en">אנגלית</option></select>
<label for="preview-tts-model" id="preview-tts-model-label" hidden>מודל Inworld (לבדיקה בלבד)</label>
<select id="preview-tts-model" hidden><option value="inworld-tts-2-flash">TTS-2 Flash</option><option value="inworld-tts-2">TTS-2</option></select>
<label for="key">מפתח ספק</label><input id="key" type="password" autocomplete="off" placeholder="אופציונלי · החיבור הקיים כבר מוגדר">
<label for="prompt" id="prompt-label">הנחיות לניסוי</label><textarea id="prompt">אתה מורה לאנגלית. תן תיקון קצר, ואז בקש מהלומד לנסות שוב.</textarea>
<label for="sample">טקסט לבדיקה</label><textarea id="sample" maxlength="1000">Yesterday I go to the store.</textarea>
<button id="preview" disabled>הפעל בדיקה</button> <button class="secondary" id="use-google-phone" hidden>בחר את הקול הזה לטלפון</button>
<div id="preview-status" class="status" role="status"></div>
<div id="answer" dir="auto"></div><audio id="audio" controls preload="metadata" hidden></audio><a id="preview-download" hidden>הורד קובץ שמע</a>
</section>
</div>
<section id="english-calls-panel" hidden>
<h2>שיחה חיה והיסטוריית 888</h2>
<label for="calls">שיחה</label><select id="calls"><option value="">עקוב אחרי השיחה האחרונה</option></select>
<div id="live-status" class="status" role="status"></div>
<div class="metrics">
<div>מודל וקול<b id="active-config">—</b></div>
<div>טוקנים · קלט / פלט<b id="tokens">—</b></div>
<div>עלות בדולרים<b id="cost">—</b></div>
<div>מתחילת השיחה עד שמע ראשון לקו<b id="latency">—</b></div>
</div>
<div id="cost-detail" class="status"></div>
<div id="summary" class="status"></div>
<h2>מדדי קטיעה ותגובה</h2><div id="turn-metrics" class="metrics" aria-live="polite"></div>
<p class="status">חזרה לדיבור מציינת השהיה ללא אישור דיבור מהתמלול. מספר נמוך יותר לבדו אינו מעיד על שיחה טובה יותר.</p>
<div id="call-tuning" class="status"></div>
<label for="compare">השווה מול שיחה</label><select id="compare"><option value="">בחר שיחה שהסתיימה</option></select>
<div id="comparison" class="status" role="status"></div>
<h2>תמלול</h2>
<div id="transcript" class="feed" role="log"></div>
<h2 style="margin-top:16px">אירועים וכלי מורה</h2>
<div id="events" class="feed log" role="log"></div>
</section>
</div>
</main>
<script>
const $ = id => document.getElementById(id);
const base = '/dashboard/pilot-888/';
const tuningDefaults = ${JSON.stringify(DEFAULT_TURN_TUNING)};
const tuningKeys = Object.keys(tuningDefaults);
function readTuning() { return Object.fromEntries(tuningKeys.map(key => [key, Number($(key).value)])); }
function setTuning(values) {
  for (const key of tuningKeys) { $(key).value = values?.[key] ?? tuningDefaults[key]; showTuningValue(key); }
}
function showTuningValue(key) { $(key + '-value').textContent = $(key).value + (key === 'energyThreshold' ? '' : ' ms'); }
function enableTuning() { $('tuning-fields').disabled = !version || !['adaptive','adaptive_clear'].includes($('interruption').value); }
function tuningChanged() { return tuningKeys.some(key => readTuning()[key] !== (version.active.tuning?.[key] ?? tuningDefaults[key])); }
function measurementText(measurements, summary) {
  if (!measurements?.events_count) return 'אין מדידות שמורות';
  const rate = summary?.duration_seconds ? (measurements.interruptions * 60 / summary.duration_seconds).toFixed(2) : null;
  return measurements.pauses + ' השהיות · ' + measurements.resumes + ' חזרות · ' + measurements.interruptions + ' קטיעות' +
    (rate === null ? '' : ' · ' + rate + ' קטיעות לדקה') +
    (measurements.response_ms == null ? '' : ' · תגובה ממוצעת ' + Math.round(measurements.response_ms) + ' ms');
}
function configurationText(row) {
  let settings; try { settings = JSON.parse(row?.details_json || '{}'); } catch { return 'הגדרות השיחה אינן זמינות'; }
  if (!settings.tuning) return 'המחוונים לא תועדו בשיחה זו';
  return 'בשיחה זו: סף ' + settings.tuning.energyThreshold + ' · צליל רציף ' + settings.tuning.minSoundMs +
    ' ms · חזרה אחרי ' + settings.tuning.resumeSilenceMs + ' ms · סוף תור ' + settings.endpoint_ms + ' ms';
}
let currentMeasurements, comparisonMeasurements, comparisonConfiguration;
let catalog, version, lastSummary, comparisonSummary, selectedCall = '', lastEvent = 0, lastTurn = 0, captureEnabled, polling = false, authorized = false;
const money = value => '$' + Number(value).toFixed(5);
const date = value => new Date(value).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'});
const write = (id, text) => { $(id).textContent = text; };
async function api(path, method = 'GET', body) {
  const response = await fetch(base + path, { method, cache: 'no-store',
    headers: body ? {'Content-Type':'application/json'} : undefined,
    body: body ? JSON.stringify(body) : undefined });
  if (response.status === 401) throw new Error('כדי לטעון נתונים, התחבר פעם אחת לחשבון הניהול הרגיל של ספיקול באותו אתר.');
  if (response.status === 403) throw new Error('המעבדה זמינה בחשבון בעלים.');
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || ('הפעולה נכשלה (' + response.status + ').'));
  }
  return response.json();
}
function options(id, entries, selected) {
  $(id).replaceChildren(...entries.map(item => new Option(item.name, item.id)));
  if (selected && !entries.some(item => item.id === selected)) $(id).add(new Option(selected + ' · הגדרה שמורה', selected));
  if (selected) $(id).value = selected;
}
function phoneVoices(selected) {
  const speech = $('speech').value;
  options('voice', catalog.voices[speech], selected);
  $('phone-google').hidden = speech !== 'google';
  $('phone-google-key').placeholder = version.googleConfigured ? 'מפתח כבר שמור · השאר ריק כדי להשתמש בו' : 'הדבק פעם אחת את מפתח Google Cloud';
}
function applySettings(result) {
  const production = 'production' in result ? result.production : version?.production;
  version = {...result, production};
  write('school-status', production ? 'תמהיל פעיל בשלוחה 1 · ' + production.model + ' / ' + production.voice : 'Gemini Live פעיל בשלוחה 1');
  $('school-promote').disabled = false;
  $('school-gemini').disabled = !production;
  options('model', catalog.models, result.active.model);
  $('speech').value = result.active.speech || 'inworld';
  phoneVoices(result.active.voice);
  $('capture').checked = Boolean(result.active.capture);
  $('interruption').value = result.active.interruption || 'adaptive';
  $('endpoint').value = result.active.endpointMs ?? '';
  setTuning(result.active.tuning); enableTuning();
  for (const id of ['model','speech','voice','interruption','endpoint','capture','save','export']) $(id).disabled = false;
  $('rollback').disabled = !result.previous;
}
async function save(rollback) {
  $('save').disabled = $('rollback').disabled = true;
  try {
    applySettings(await api('settings', 'PUT', rollback ? {rollback:true} : {
      model:$('model').value, voice:$('voice').value, capture:$('capture').checked, speech:$('speech').value,
      tuning:readTuning(), interruption:$('interruption').value, endpointMs:$('endpoint').value ? Number($('endpoint').value) : null,
      googleKey:$('speech').value === 'google' ? $('phone-google-key').value : undefined }));
    $('phone-google-key').value = '';
    $('handoff').hidden = true;
    write('export-status', '');
    write('settings-status', (rollback ? 'הגרסה הקודמת שוחזרה. ' : 'הגרסה נשמרה. ') + 'השינוי יחול בחיוג הבא.');
  } catch (error) {
    write('settings-status', error.message);
    $('save').disabled = false;
    $('rollback').disabled = !version.previous;
  }
}
function updatePreview() {
  const mode = $('mode').value;
  const isModel = mode === 'model';
  $('use-google-phone').hidden = mode !== 'google';
  for (const id of ['preview-language','preview-language-label','preview-tts-model','preview-tts-model-label']) $(id).hidden = mode !== 'inworld';
  options('preview-choice', isModel ? catalog.models : catalog.voices[mode]);
  if (mode === 'yiddish') $('sample').value = 'שלום עליכם! ווי גייט עס דיר היינט? איך וויל לערנען מיט דיר אַ ביסל ייִדיש.';
  $('key').value = '';
  $('key').placeholder = mode === 'google' ? 'הדבק כאן מפתח Google Cloud Text-to-Speech' : mode === 'yiddish' ? 'מפתח Yiddish Tools · יישמר בערוץ לאחר בדיקה מוצלחת' : 'אופציונלי · החיבור הקיים כבר מוגדר';
  $('prompt').hidden = $('prompt-label').hidden = !isModel;
  write('choice-label', isModel ? 'מודל' : 'קול');
}
function resetAudio(audioId,linkId){const audio=$(audioId),link=$(linkId);audio.pause();if(audio.dataset.url){URL.revokeObjectURL(audio.dataset.url);delete audio.dataset.url;}audio.removeAttribute('src');audio.hidden=true;link.removeAttribute('href');link.hidden=true;}
async function presentAudio(data,audioId,linkId,statusId){
  if(!data.audio)throw new Error('לא התקבלו נתוני שמע');resetAudio(audioId,linkId);
  const audio=$(audioId),link=$(linkId);const mime=data.mime||'audio/mpeg';const raw=atob(data.audio);const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(bytes.length<44)throw new Error('קובץ השמע שהתקבל ריק');
  const url=URL.createObjectURL(new Blob([bytes],{type:mime}));audio.dataset.url=url;audio.hidden=false;link.href=url;link.download='speakcall-preview.'+(mime==='audio/wav'?'wav':'mp3');link.hidden=false;
  const ready=new Promise((resolve,reject)=>{const cleanup=()=>{clearTimeout(timer);audio.removeEventListener('loadedmetadata',ok);audio.removeEventListener('error',fail);};const ok=()=>{cleanup();resolve();};const fail=()=>{cleanup();reject(new Error('הדפדפן לא הצליח לפענח את השמע. ניתן להוריד את הקובץ.'));};const timer=setTimeout(fail,7000);audio.addEventListener('loadedmetadata',ok,{once:true});audio.addEventListener('error',fail,{once:true});});
  audio.src=url;audio.load();await ready;
  const duration=Number.isFinite(audio.duration)?audio.duration:data.durationSeconds;
  write(statusId,'שמע מוכן · '+(duration?duration.toFixed(1)+' שניות · ':'')+data.ms+' ms · לחץ על נגן או הורד את הקובץ');
  try{await audio.play();}catch{ /* Safari/Chrome may require a second deliberate click. */ }
}
async function preview() {
  $('preview').disabled = true;
  write('preview-status', 'מחכה לתשובה מהספק…');
  write('answer', '');
  resetAudio('audio','preview-download');
  try {
    const mode = $('mode').value;
    const enteredKey=$('key').value.trim();
    const data = mode==='yiddish' ? await api(channelApi('preview'),'POST',{text:$('sample').value,voice:$('preview-choice').value,...(enteredKey?{speechKey:enteredKey}:{})}) : await api('preview', 'POST', { mode, key:$('key').value, text:$('sample').value,
      model:$('preview-choice').value, voice:$('preview-choice').value, prompt:$('prompt').value,
      ...(mode === 'inworld' ? {language:$('preview-language').value, ttsModel:$('preview-tts-model').value} : {}) });
    write('preview-status', data.ms + ' אלפיות שנייה' + (data.usage ?
      ' · קלט ' + (data.usage.prompt_tokens ?? '—') + ' · פלט ' + (data.usage.completion_tokens ?? '—') +
      (typeof data.usage.cost === 'number' ? ' · ' + money(data.usage.cost) : '') :
      data.characters ? ' · ' + data.characters + ' תווים' : ''));
    if (data.text) write('answer', data.text);
    if (data.audio) {if(mode==='yiddish'&&enteredKey){$('key').value='';$('yiddish-speech-key').placeholder='מפתח שמור · ריק לשמירתו';}await presentAudio(data,'audio','preview-download','preview-status');}
  } catch (error) { write('preview-status', error.message); }
  finally { $('preview').disabled = false; }
}
function append(id, text, direction) {
  const box = $(id);
  const follow = box.scrollHeight - box.clientHeight - box.scrollTop < 30;
  if (direction === 'output' && box.lastElementChild?.dataset.direction === direction) {
    box.lastElementChild.append(text);
  } else {
    const line = document.createElement('p');
    line.dir = 'auto';
    line.dataset.direction = direction || '';
    line.textContent = (direction ? (direction === 'input' ? 'לומד · ' : 'מורה · ') : '') + text;
    box.append(line);
  }
  if (follow) box.scrollTop = box.scrollHeight;
}
const eventLabels = {
  session_started:'תחילת שיחה', access_checked:'בדיקת גישה', learning_plan_ready:'תוכנית שיעור נטענה',
  cascade_connect_started:'חיבור למנוע הקול', greeting_sent:'פתיחה נשלחה למודל', first_pbx_audio:'שמע ראשון מהקו',
  first_gemini_audio:'שמע מהספק', first_audio_sent_to_phone:'שמע ראשון נשלח לקו', tutor_interrupted:'המורה נקטע',
  tutor_turn_complete:'המורה סיים תור', ai_connection_closed:'החיבור למורה נסגר',
  audio_queue_at_end:'מצב תור השמע בסיום', session_saved:'השיחה נשמרה',
  pilot_interruption_candidate:'חשד לקטיעה', pilot_interruption_resumed:'המשך אחרי חשד לקטיעה',
  pilot_turn_to_audio:'מסוף תור שזוהה עד שמע לקו',
  cascade_usage:'נתוני עלות סופיים', pilot_usage:'שימוש במודל התקבל', pilot_tool:'כלי מורה'
};
function showComparison() {
  const baseline = comparisonSummary;
  if (!baseline) { write('comparison', comparisonMeasurements ? measurementText(comparisonMeasurements, null) : ''); return; }
  const delta = lastSummary ? lastSummary.estimated_cost_usd - baseline.estimated_cost_usd : null;
  write('comparison', 'שיחת ההשוואה · ' + (baseline.model || 'מודל לא נרשם') +
    ' · ' + baseline.duration_seconds + ' שניות · ' + baseline.input_text_tokens + ' / ' + baseline.output_text_tokens +
    ' טוקנים · ' + money(baseline.estimated_cost_usd) +
    (baseline.duration_seconds ? ' · ' + money(baseline.estimated_cost_usd * 3600 / baseline.duration_seconds) + ' לשעה' : '') +
    (delta === null ? '' : ' · הפרש בעלות הכוללת של השיחה הנבחרת ' + (delta < 0 ? '−' : '+') + money(Math.abs(delta))) + String.fromCharCode(10) + measurementText(comparisonMeasurements, baseline) + String.fromCharCode(10) + configurationText(comparisonConfiguration));
}
async function compare() {
  comparisonSummary = null; comparisonMeasurements = null; comparisonConfiguration = null;
  const id = $('compare').value;
  showComparison();
  if (!id) return;
  try {
    const result = await api('calls?id=' + encodeURIComponent(id) + '&after=9007199254740991&afterTurn=9007199254740991');
    if ($('compare').value !== id) return;
    comparisonSummary = result.summary; comparisonMeasurements = result.measurements; comparisonConfiguration = result.configuration;
    showComparison();
    if (!comparisonSummary) write('comparison', 'לא נשמר סיכום לשיחה זו.');
  } catch (error) { write('comparison', error.message); }
}
async function refresh() {
  if (!authorized || polling || document.hidden) return;
  polling = true;
  try {
    const {calls} = await api('calls');
    const pinned = $('calls').value;
    if (document.activeElement !== $('calls')) {
      options('calls', [{id:'',name:'עקוב אחרי השיחה האחרונה'}, ...calls.map(call => ({
        id:call.call_id, name:date(call.started_at) + (call.ended ? ' · הסתיימה' : ' · טרם תועד סיום')
      }))], pinned);
    }
    if (document.activeElement !== $('compare')) {
      options('compare', [{id:'',name:'בחר שיחה שהסתיימה'}, ...calls.filter(call => call.duration_seconds !== null).map(call => ({
        id:call.call_id, name:date(call.started_at) + (call.model ? ' · ' + call.model : '')
      }))], $('compare').value);
    }
    const call = calls.find(item => item.call_id === pinned) ?? calls[0];
    if (!call) { write('live-status', 'ממתין לחיוג ל־888.'); return; }
    if (selectedCall !== call.call_id) {
      selectedCall = call.call_id;
      lastEvent = lastTurn = 0;
      captureEnabled = undefined;
      lastSummary = null;
      showComparison();
      for (const id of ['transcript','events','summary','cost-detail','turn-metrics','call-tuning']) write(id, '');
      for (const id of ['active-config','cost','tokens','latency']) write(id, '—');
    }
    const result = await api('calls?id=' + encodeURIComponent(selectedCall) + '&after=' + lastEvent + '&afterTurn=' + lastTurn);
    currentMeasurements = result.measurements;
    write('turn-metrics', measurementText(currentMeasurements, result.summary));
    write('call-tuning', configurationText(result.configuration));
    write('live-status', (call.ended ? 'שיחה שהסתיימה' : 'טרם תועד סיום') + ' · ' + date(call.started_at));
    for (const event of result.events) {
      lastEvent = event.id;
      let details = {};
      try { details = JSON.parse(event.details_json); } catch {}
      if (event.event_name === 'session_started') {
        captureEnabled = details.transcript_enabled;
        if (details.model) write('active-config', details.model + ' / ' + [details.speech, details.voice].filter(Boolean).join(' · '));
      }
      if (event.event_name === 'first_audio_sent_to_phone') write('latency', Math.round(event.since_call_start_ms) + ' ms');
      if (event.event_name === 'pilot_usage') write('tokens', details.input + ' / ' + details.output);
      if (event.event_name === 'pilot_usage' || event.event_name === 'cascade_usage') {
        write('cost', money(details.total));
        write('cost-detail', 'מודל מדווח ' + money(details.llm_reported_usd) +
          ' · תמלול משוער ' + money(details.stt_estimated_usd) + ' · הקראה משוערת ' + money(details.tts_estimated_usd));
      }
      append('events', Math.round(event.since_call_start_ms) + ' ms · ' +
        (eventLabels[event.event_name] || event.event_name) +
        (details.name ? ' · ' + details.name + (details.saved ? ' · נשמר' : ' · לא נשמר') : '') +
        (typeof details.elapsed_ms === 'number' ? ' · ' + details.elapsed_ms + ' ms' : '') +
        (typeof details.candidate_ms === 'number' ? ' · אישור אחרי ' + details.candidate_ms + ' ms' : '') +
        (details.clear_sent ? ' · נשלחה פקודת ניקוי לטכנוליין' : ''));
    }
    for (const turn of result.turns) {
      if (lastTurn === 0) write('transcript', '');
      lastTurn = turn.id;
      append('transcript', turn.text, turn.direction);
    }
    if (!lastTurn) write('transcript', captureEnabled ? 'ממתין לתמלול.' : 'אין תמלול שמור לשיחה הזאת.');
    if (result.summary) {
      const s = lastSummary = result.summary;
      showComparison();
      if ($('active-config').textContent === '—' && s.model) write('active-config', s.model);
      write('tokens', s.input_text_tokens + ' / ' + s.output_text_tokens);
      write('cost', money(s.estimated_cost_usd) + (s.duration_seconds ? ' · ' + money(s.estimated_cost_usd * 3600 / s.duration_seconds) + ' לשעה' : ''));
      write('summary', [s.duration_seconds + ' שניות', s.learner_turns + ' תורי לומד', s.tutor_turns + ' תורי מורה',
        s.summary_he, s.success_he, s.next_step_he].filter(Boolean).join(' · '));
    }
  } catch (error) { write('live-status', error.message); }
  finally { polling = false; }
}
$('export').onclick = async () => {
  if ($('speech').value !== (version.active.speech || 'inworld') || $('model').value !== version.active.model || $('voice').value !== version.active.voice ||
      $('interruption').value !== (version.active.interruption || 'adaptive') ||
      $('endpoint').value !== String(version.active.endpointMs ?? '') || tuningChanged() ||
      $('capture').checked !== Boolean(version.active.capture)) {
    write('export-status', 'שמור את השינויים לפני הייצוא.');
    return;
  }
  $('export').disabled = true;
  try {
    $('handoff-data').value = JSON.stringify(await api('settings?export=1'), null, 2);
    $('handoff').hidden = false;
    write('export-status', 'התמהיל מוכן להעתקה או להורדה.');
  } catch (error) { write('export-status', error.message); }
  finally { $('export').disabled = false; }
};
$('copy-handoff').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('handoff-data').value);
    write('export-status', 'התמהיל הועתק.');
  } catch {
    $('handoff-data').select();
    write('export-status', 'התמהיל סומן. אפשר להעתיק או להוריד כקובץ.');
  }
};
$('download-handoff').onclick = () => {
  const url = URL.createObjectURL(new Blob([$('handoff-data').value], {type:'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'speakcall-888-to-1.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};
$('speech').onchange = () => phoneVoices($('speech').value === (version.active.speech || 'inworld') ? version.active.voice : undefined);
$('use-google-phone').onclick = () => {
  $('speech').value = 'google';
  phoneVoices($('preview-choice').value);
  if ($('key').value.trim()) $('phone-google-key').value = $('key').value;
  openTab('settings');$('save').scrollIntoView({block:'center'});
  $('save').focus();
};
async function school(mode) {
  if (mode === 'cascade' && tuningChanged()) { write('school-status','שמור תחילה את המחוונים, ואז החל את התמהיל על שלוחה 1.'); return; }
  $('school-promote').disabled = $('school-gemini').disabled = true;
  try {
    const {production} = await api('settings', 'PUT', {production:mode});
    applySettings({...version, production});
    write('school-status', $('school-status').textContent + ' · מהחיוג הבא');
  } catch (error) {
    write('school-status', error.message);
    $('school-promote').disabled = false;
    $('school-gemini').disabled = !version.production;
  }
}
for (const key of tuningKeys) $(key).oninput = () => showTuningValue(key);
$('interruption').onchange = enableTuning;
$('reset-tuning').onclick = () => { setTuning(tuningDefaults); write('settings-status','הערכים המומלצים הוצגו. לחץ שמור לחיוג הבא כדי להחיל.'); };
$('school-promote').onclick = () => school('cascade');
$('school-gemini').onclick = () => school('gemini');
$('save').onclick = () => save(false);
$('rollback').onclick = () => save(true);
$('calls').onchange = refresh;
$('compare').onchange = compare;
$('mode').onchange = () => { if (catalog) updatePreview(); };
$('preview').onclick = preview;
let currentChannel='yiddish',activeChannel='yiddish',activeTab='connection',registry=[{id:'yiddish',name:'יידיש'}],channelSettings=null;
const channelApi=(action)=>'channels/'+currentChannel+'/'+action;
const independent=()=>!['1','888'].includes(activeChannel);
function renderCards(){const channels=[{id:'1',name:'שלוחה 1',desc:'המורה הפעיל · אנגלית'},{id:'888',name:'שלוחה 888',desc:'מעבדת ניסוי · אנגלית'},...registry.map(c=>({...c,desc:'ערוץ עצמאי'}))];$('channel-cards').replaceChildren(...channels.map(c=>{const b=document.createElement('button');b.className='channel-card';b.type='button';b.setAttribute('aria-pressed',String(c.id===activeChannel));const title=document.createElement('strong');title.textContent=c.name;const desc=document.createElement('small');desc.textContent=c.desc;b.append(title,desc);b.onclick=()=>selectChannel(c.id);return b;}));}
async function loadChannels(){try{const data=await api('channels');registry=data.channels;renderCards();}catch(error){write('channel-status',error.message);}}
function openTab(tab){activeTab=tab;const panels=['channel-connect-panel','channel-teacher-panel','channel-preview-panel','channel-calls-panel','english-settings-panel','school-panel','english-preview-panel','english-calls-panel'];for(const id of panels)$(id).hidden=true;const map=independent()?{connection:'channel-connect-panel',settings:'channel-teacher-panel',preview:'channel-preview-panel',calls:'channel-calls-panel'}:activeChannel==='1'?{settings:'school-panel'}:{settings:'english-settings-panel',preview:'english-preview-panel',calls:'english-calls-panel'};if(map[tab])$(map[tab]).hidden=false;for(const b of $('channel-tabs').querySelectorAll('button'))b.setAttribute('aria-selected',String(b.dataset.tab===tab));if(tab==='calls'){if(independent())loadChannelCalls();else refresh();}}
function selectChannel(id){activeChannel=id;if(independent())currentChannel=id;renderCards();$('yiddish-panel').hidden=!independent();$('english-layout').hidden=independent();const name=independent()?registry.find(c=>c.id===id)?.name||id:'שלוחה '+id;write('active-channel-title',name);write('active-channel-description',independent()?'ערוץ Cascade · ספקים עצמאיים':id==='888'?'סביבת ניסוי · לא משנה את המורה הפעיל':'המורה הפעיל באנגלית · שינוי תמהיל מפורש בלבד');const tabs=independent()?[['connection','חיבור'],['settings','הגדרות מורה'],['preview','בדיקת דפדפן'],['calls','שיחות']]:id==='888'?[['settings','הגדרות מורה'],['preview','בדיקת דפדפן'],['calls','שיחות']]:[['settings','הגדרות מורה']];$('channel-tabs').replaceChildren(...tabs.map(([key,label])=>{const b=document.createElement('button');b.textContent=label;b.dataset.tab=key;b.onclick=()=>openTab(key);return b;}));openTab(tabs[0][0]);if(independent()){resetAudio('channel-audio','channel-download');write('yiddish-status','');loadYiddish();}}
function updateChannelVoices(test=false,selected){const mode=$(test?'channel-test-speech':'channel-speech').value;options(test?'channel-test-voice':'yiddish-voice',catalog.voices[mode],selected);if(!test)$('channel-inworld-options').hidden=mode!=='inworld';}
$('channel-speech').onchange=()=>updateChannelVoices();$('channel-test-speech').onchange=()=>updateChannelVoices(true);
function showChannelSettings(settings){channelSettings=settings;$('channel-speech').value=$('channel-test-speech').value=settings.speech||'yiddish';updateChannelVoices(false,settings.voice);updateChannelVoices(true,settings.voice);$('channel-inworld-language').value=settings.speechLanguage||'auto';$('channel-inworld-model').value=settings.inworldModel||'inworld-tts-2-flash';$('yiddish-model').value=settings.model;$('channel-stt').value=settings.stt||'yiddish-tools';$('channel-interruption').value=settings.interruption||'adaptive';$('channel-endpoint').value=String(settings.endpointMs||700);$('channel-capture').checked=settings.capture!==false;for(const key of tuningKeys){$('channel-'+key).value=settings.tuning?.[key]??tuningDefaults[key];showChannelTuning(key);}$('channel-rollback').disabled=!settings.previousAvailable;$('yiddish-prompt').value=settings.prompt;$('yiddish-greeting').value=settings.greeting;$('yiddish-wss').value=settings.wss;for(const id of ['yiddish-channel-token','yiddish-speech-key','yiddish-model-key','channel-inworld-key','channel-google-key'])$(id).value='';$('yiddish-channel-token').placeholder=settings.tokenConfigured?'✓ טוקן שמור · ריק לשמירתו':'הזן מזהה ערוץ';$('yiddish-speech-key').placeholder=settings.speechKeySaved?'✓ מפתח שמור · ריק לשמירתו':'הדבק כאן מפתח Yiddish Tools';$('yiddish-model-key').placeholder=settings.modelKeySaved?'✓ מפתח שמור · ריק לשמירתו':'אופציונלי · מפתח השרת';$('channel-inworld-key').placeholder=settings.inworldKeySaved?'✓ מפתח שמור':'אופציונלי · מפתח השרת';$('channel-google-key').placeholder=settings.googleKeySaved?'✓ מפתח שמור':'הזן מפתח אם נדרש';$('yiddish-save').disabled=$('channel-connect-save').disabled=false;write('channel-connect-status',(settings.speechKeySaved?'מפתח Yiddish Tools שנשמר בערוץ':'מפתח ערוץ טרם נשמר · הזן את המפתח כאן')+(settings.tokenConfigured?' · טוקן מוגדר':' · טוקן חסר')+(settings.lastError?' · תקלה אחרונה: '+settings.lastError:''));}
async function loadYiddish(){const id=currentChannel;$('yiddish-save').disabled=$('channel-connect-save').disabled=true;try{const settings=await api(channelApi('settings'));if(activeChannel===id)showChannelSettings(settings);}catch(error){write('channel-connect-status',error.message);}}
$('toggle-create').onclick=()=>{$('create-panel').hidden=!$('create-panel').hidden;};
$('create-channel').onclick=async()=>{try{const id=$('new-channel-id').value.trim();await api('channels','POST',{id,name:$('new-channel-name').value.trim()});await loadChannels();$('create-panel').hidden=true;selectChannel(id);write('channel-status','הערוץ נוצר');}catch(error){write('channel-status',error.message);}};
$('copy-yiddish-wss').onclick=()=>{navigator.clipboard.writeText($('yiddish-wss').value).catch(()=>{$('yiddish-wss').select();});};
$('go-channel-preview').onclick=()=>openTab('preview');
$('channel-connect-save').onclick=async()=>{const id=currentChannel;$('channel-connect-save').disabled=true;try{const body={};for(const [field,input] of [['token','yiddish-channel-token'],['speechKey','yiddish-speech-key'],['modelKey','yiddish-model-key'],['inworldKey','channel-inworld-key'],['googleKey','channel-google-key']]){const value=$(input).value.trim();if(value)body[field]=value;}const result=await api(channelApi('settings'),'PUT',body);if(activeChannel===id){showChannelSettings(result);write('channel-connect-status','החיבורים נשמרו. כעת אפשר לבדוק הקראה בלשונית בדיקת דפדפן.');}}catch(error){write('channel-connect-status',error.message);}finally{$('channel-connect-save').disabled=false;}};
$('yiddish-save').onclick=async()=>{const id=currentChannel;$('yiddish-save').disabled=true;try{const result=await api(channelApi('settings'),'PUT',{voice:$('yiddish-voice').value,speech:$('channel-speech').value,speechLanguage:$('channel-inworld-language').value,inworldModel:$('channel-inworld-model').value,model:$('yiddish-model').value,stt:$('channel-stt').value,interruption:$('channel-interruption').value,endpointMs:Number($('channel-endpoint').value),capture:$('channel-capture').checked,tuning:Object.fromEntries(tuningKeys.map(key=>[key,Number($('channel-'+key).value)])),prompt:$('yiddish-prompt').value,greeting:$('yiddish-greeting').value});if(activeChannel===id){showChannelSettings(result);write('teacher-status','נשמר לחיוג הבא בערוץ זה.');}}catch(error){write('teacher-status',error.message);}finally{$('yiddish-save').disabled=false;}};
$('choose-phone-voice').onclick=async()=>{try{const result=await api(channelApi('settings'),'PUT',{voice:$('channel-test-voice').value,speech:$('channel-test-speech').value});showChannelSettings(result);write('yiddish-status','הקול נשמר לחיוג הבא בערוץ זה.');}catch(error){write('yiddish-status',error.message);}};
$('yiddish-listen').onclick=async()=>{const id=currentChannel;$('yiddish-listen').disabled=true;write('yiddish-status','ממתין לספק…');resetAudio('channel-audio','channel-download');try{const result=await api(channelApi('preview'),'POST',{text:$('channel-sample').value,voice:$('channel-test-voice').value,speech:$('channel-test-speech').value});if(activeChannel===id)await presentAudio(result,'channel-audio','channel-download','yiddish-status');}catch(error){write('yiddish-status',error.message);}finally{$('yiddish-listen').disabled=false;}};
let channelCalls=[],channelLiveCall=null;
const avgChannel=(call,field)=>{const values=(call?.timings||[]).map(t=>t[field]).filter(v=>typeof v==='number');return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;};
const secs=ms=>typeof ms==='number'?(ms/1000).toFixed(2)+' שנ׳':'—';
function channelKey(c){return c.id||c.startedAt;}
function renderChannelCall(){const key=$('channel-call-select').value;const c=key?[channelLiveCall,...channelCalls].find(x=>x&&channelKey(x)===key):channelLiveCall||channelCalls[0];write('channel-call-config',c?[c.model,c.voice,c.stt||'yiddish-tools'].join(' / '):'—');write('channel-call-tokens',c?.metrics?c.metrics.inputTokens+' / '+c.metrics.outputTokens:'—');write('channel-call-latency',secs(c?.firstAudioMs));const m=c?.metrics;write('channel-call-cost',m?'$'+((m.modelUsd||0)+m.estimatedSpeechUsd+m.estimatedSttUsd).toFixed(5):'—');write('channel-cost-detail',m?'הערכה לפי קרדיטים להקראה ותמלול'+(m.modelUsd===null?' · עלות המודל לא התקבלה מהספק':' · עלות המודל מדווחת מהספק'):'');const events=c?.events||[];const count=name=>events.filter(e=>e.name===name).length;const metricRows=[['קטיעות',count('tutor_interrupted')],['השהיות',count('pilot_interruption_candidate')],['חזרה לדיבור',count('pilot_interruption_resumed')],['תגובה ממוצעת לתלמיד',secs(avgChannel(c,'totalMs'))],['תמלול',secs(avgChannel(c,'sttMs'))],['מודל',secs(avgChannel(c,'modelMs'))],['הקראה עד שמע ראשון',secs(avgChannel(c,'ttsFirstMs'))]];$('channel-turn-metrics').replaceChildren(...metricRows.map(([label,value])=>{const div=document.createElement('div');div.textContent=label;const b=document.createElement('b');b.textContent=c?.events?String(value):'—';div.append(b);return div;}));write('channel-call-tuning',c?.tuning?'בשיחה זו: סף '+c.tuning.energyThreshold+' · צליל '+c.tuning.minSoundMs+' ms · חזרה '+c.tuning.resumeSilenceMs+' ms · סוף תור '+c.endpointMs+' ms':'אין תיעוד מחוונים בשיחה זו');const textRows=c?.transcript||[];$('channel-transcript').replaceChildren(...(textRows.length?textRows.map(t=>{const p=document.createElement('p');p.dir='auto';p.textContent=(t.direction==='input'?'לומד · ':'מורה · ')+t.text;return p;}):[document.createTextNode(c?.capture===false?'שמירת התמלול כובתה בשיחה זו.':'אין תמלול זמין לשיחה זו.')]));$('channel-events').replaceChildren(...(events.length?events.map(e=>{const p=document.createElement('p');p.textContent=secs(e.atMs)+' · '+e.name+(e.detail?' · '+e.detail:'');return p;}):[document.createTextNode('אין אירועים מפורטים לשיחה זו.')]));const compared=channelCalls.find(x=>channelKey(x)===$('channel-call-compare').value);write('channel-comparison',compared&&c?'תגובה: '+secs(avgChannel(c,'totalMs'))+' לעומת '+secs(avgChannel(compared,'totalMs'))+' · תמלול: '+secs(avgChannel(c,'sttMs'))+' לעומת '+secs(avgChannel(compared,'sttMs')):'');}
async function loadChannelCalls(){const id=currentChannel;try{const result=await api(channelApi('calls'));if(activeChannel!==id)return;channelCalls=result.calls;channelLiveCall=result.liveCall||null;const selected=$('channel-call-select').value,compared=$('channel-call-compare').value;const list=[...(channelLiveCall?[channelLiveCall]:[]),...channelCalls];const entry=c=>({id:channelKey(c),name:date(c.startedAt)+' · '+c.durationSeconds+' שנ׳'+(c===channelLiveCall?' · פעילה':'')});options('channel-call-select',[{id:'',name:'עקוב אחרי השיחה האחרונה'},...list.map(entry)],selected);options('channel-call-compare',[{id:'',name:'בחר שיחה שהסתיימה'},...channelCalls.map(entry)],compared);const labels={caller_disconnected:'המתקשר סיים',tts_failed_401:'מפתח ספק נדחה (401)',time_limit:'מגבלת זמן',stt_timeout:'המתנה לתמלול',audio_format:'פורמט שמע לא תקין'};const rows=list.map(c=>{const tr=document.createElement('tr');for(const value of [date(c.startedAt),c.durationSeconds+' שנ׳',secs(c.firstAudioMs),secs(avgChannel(c,'totalMs')),[secs(avgChannel(c,'sttMs')),secs(avgChannel(c,'modelMs')),secs(avgChannel(c,'ttsFirstMs'))].join(' / '),c.voice,c.turns,c===channelLiveCall?'פעילה':labels[c.outcome]||c.outcome]){const td=document.createElement('td');td.textContent=value;tr.append(td);}return tr;});$('channel-calls-rows').replaceChildren(...rows);write('channel-calls-status',result.active?'שיחה פעילה כעת':rows.length?rows.length+' שיחות שמורות':'טרם נשמרו שיחות בערוץ זה.');renderChannelCall();}catch(error){write('channel-calls-status',error.message);}}
$('channel-call-select').onchange=renderChannelCall;$('channel-call-compare').onchange=renderChannelCall;
$('reload-channel-calls').onclick=loadChannelCalls;
function showChannelTuning(key){write('channel-'+key+'-value',$('channel-'+key).value+(key==='energyThreshold'?'':' ms'));}
for(const key of tuningKeys)$('channel-'+key).oninput=()=>showChannelTuning(key);
$('channel-reset-tuning').onclick=()=>{for(const key of tuningKeys){$('channel-'+key).value=tuningDefaults[key];showChannelTuning(key);}write('teacher-status','ערכי ברירת המחדל הוצגו. לחץ שמור להגדרות החיוג הבא.');};
$('channel-rollback').onclick=async()=>{try{showChannelSettings(await api(channelApi('settings'),'PUT',{rollback:true}));write('teacher-status','הגרסה הקודמת שוחזרה לחיוג הבא.');}catch(error){write('teacher-status',error.message);}};
$('channel-export').onclick=()=>{if(!channelSettings)return;const fields=['voice','speech','speechLanguage','inworldModel','stt','model','prompt','greeting','capture','tuning','endpointMs','interruption'];const config=Object.fromEntries(fields.map(k=>[k,channelSettings[k]]));const url=URL.createObjectURL(new Blob([JSON.stringify({channel:currentChannel,...config},null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='speakcall-'+currentChannel+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
$('model-status-check').onclick=async()=>{try{const d=await api(channelApi('model-status'));write('model-status-result',d.status===200?'המפתח תקין · שימוש $'+Number(d.usage||0).toFixed(3)+(typeof d.limit_remaining==='number'?' · מגבלה שנותרה $'+d.limit_remaining.toFixed(3):' · לא הוצגה מגבלת מפתח'):'OpenRouter: '+(d.status||d.error||'מפתח לא מוגדר'));}catch(error){write('model-status-result',error.message);}};

$('stt-compare').onclick=async()=>{const button=$('stt-compare');const result=$('stt-compare-result');const file=$('stt-sample-file').files[0];if(!file){result.textContent='בחר הקלטה קצרה תחילה';return;}button.disabled=true;result.textContent='מתמלל בשני המנועים…';let context;try{if(file.size>8*1024*1024)throw new Error('קובץ גדול מדי');context=new AudioContext();const decoded=await context.decodeAudioData(await file.arrayBuffer());if(decoded.duration>12||decoded.duration<0.1)throw new Error('יש לבחור הקלטה של עד 12 שניות');const offline=new OfflineAudioContext(1,Math.ceil(decoded.duration*8000),8000);const src=offline.createBufferSource();src.buffer=decoded;src.connect(offline.destination);src.start();const floats=(await offline.startRendering()).getChannelData(0);const pcm=new Int16Array(floats.length);for(let i=0;i<floats.length;i++)pcm[i]=Math.round(Math.max(-1,Math.min(1,floats[i]))*32767);const bytes=new Uint8Array(pcm.buffer);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));const id=currentChannel;const data=await api(channelApi('stt-test'),'POST',{pcm:btoa(binary)});if(activeChannel!==id)return;result.replaceChildren(...data.results.map(r=>{const p=document.createElement('p');const title=document.createElement('strong');title.textContent=(r.mode==='gemini'?'Gemini':'Yiddish Tools')+' · '+(r.ms/1000).toFixed(2)+' שניות';p.append(title,document.createElement('br'),document.createTextNode(r.error||r.text||'לא זוהה דיבור'));return p;}));}catch(error){result.textContent=error.message;}finally{if(context)await context.close().catch(()=>{});button.disabled=false;}};

(async () => {
  try {
    const settings = await api('settings');
    authorized = true;
    catalog = await api('catalog');
    applySettings(settings);
    await loadChannels();
    updatePreview();
    selectChannel('yiddish');
    $('preview').disabled = false;
    write('settings-status', 'ההגדרה הפעילה נטענה.');
  } catch (error) { write('access', error.message); }
})();
setInterval(()=>{if(activeTab==='calls'){if(independent())loadChannelCalls();else if(activeChannel==='888')refresh();}},5000);
</script>
</html>`;

export function pilotSettingsPage(): Response {
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; media-src data: blob:; frame-ancestors 'self'",
  } });
}
