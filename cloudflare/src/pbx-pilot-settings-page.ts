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
@media(max-width:780px){.layout{grid-template-columns:1fr}main{padding:16px}}
</style>
<main>
<header><h1>מעבדת הקול של ספיקול</h1><a href="/dashboard">ממשק הניהול</a></header>
<div id="access" class="status" role="status"></div>
<section><h2>מנהל ערוצי הקול</h2><div class="line"><button class="secondary" id="channel-english">אנגלית · 1 / 888</button><button class="secondary" id="channel-yiddish">ערוצים עצמאיים</button></div><p class="status">כל ערוץ עצמאי שומר הגדרות ומפתחות משלו. שינוי אינו משפיע על 1 או 888.</p><label for="channel-select">בחר ערוץ עצמאי לעריכה</label><select id="channel-select"><option value="yiddish">יידיש</option></select><details><summary>צור ערוץ חדש</summary><label for="new-channel-name">שם הערוץ</label><input id="new-channel-name" maxlength="60"><label for="new-channel-id">מזהה באנגלית (אותיות קטנות, ספרות ומקף)</label><input id="new-channel-id" dir="ltr" maxlength="40"><button id="create-channel">צור ערוץ</button></details><p id="channel-status" class="status"></p></section>
<section id="yiddish-panel" hidden><h2 id="channel-heading">הגדרות ערוץ לחיוג הבא</h2><p>תמהיל Cascade · תמלול והקראה Yiddish Tools · מודל OpenRouter</p><label for="yiddish-model">מודל המורה</label><select id="yiddish-model"><option value="google/gemini-2.5-flash">Gemini 2.5 Flash</option><option value="openai/gpt-4.1-mini">GPT-4.1 mini</option><option value="qwen/qwen3-235b-a22b-2507">Qwen 3 235B</option></select><label for="yiddish-voice">קול בטלפון</label><select id="yiddish-voice"></select><label for="yiddish-prompt">הנחיות המורה</label><textarea id="yiddish-prompt" maxlength="6000" rows="5"></textarea><label for="yiddish-greeting">משפט פתיחה</label><textarea id="yiddish-greeting" maxlength="500"></textarea><fieldset><legend>חיבורים קבועים לערוץ</legend><label for="yiddish-channel-token">אסימון אירוע start מטכנוליין</label><input id="yiddish-channel-token" type="password" autocomplete="off"><label for="yiddish-speech-key">מפתח API של Yiddish Tools</label><input id="yiddish-speech-key" type="password" autocomplete="off"><label for="yiddish-model-key">מפתח OpenRouter (אופציונלי אם מוגדר בשרת)</label><input id="yiddish-model-key" type="password" autocomplete="off"><p class="status">שדות ריקים בשמירה משאירים את הערכים הקיימים. המפתחות נשמרים בשרת ואינם מוצגים מחדש.</p></fieldset><label for="yiddish-wss">כתובת WSS · קבועה לערוץ</label><input id="yiddish-wss" dir="ltr" readonly><button id="copy-yiddish-wss" class="secondary">העתק כתובת</button><button id="yiddish-save" disabled>שמור לערוץ בלבד</button><label for="channel-sample">בדיקת שמע עם המפתח השמור</label><textarea id="channel-sample" maxlength="1000">שלום עליכם! ווי גייט עס דיר היינט?</textarea><button id="yiddish-listen" class="secondary">האזן לקול בדפדפן</button><audio id="channel-audio" controls hidden></audio><p id="yiddish-status" role="status"></p><p class="status">התמלול הניסיוני אינו בהזרמה ולכן תגובת המורה עשויה להתעכב.</p></section>
<div class="layout" id="english-layout">
<div>
<section>
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
<section>
<h2>מורה בשלוחה 1</h2>
<p id="school-status" class="status" role="status"></p>
<button id="school-promote" disabled>החל את התמהיל השמור על שלוחה 1</button>
<button id="school-gemini" class="secondary" disabled>חזור ל־Gemini Live</button>
</section>
<section>
<h2>בדיקה בדפדפן</h2>
<label for="mode">מה לבדוק</label>
<select id="mode"><option value="model">תשובת מודל · OpenRouter</option><option value="inworld">קול · Inworld</option><option value="google">קול · Google Standard</option><option value="yiddish">קול · Yiddish Tools</option></select>
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
<div id="answer" dir="auto"></div><audio id="audio" controls hidden></audio>
</section>
</div>
<section>
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
  $('key').placeholder = mode === 'google' ? 'הדבק כאן מפתח Google Cloud Text-to-Speech' : 'אופציונלי · החיבור הקיים כבר מוגדר';
  $('prompt').hidden = $('prompt-label').hidden = !isModel;
  write('choice-label', isModel ? 'מודל' : 'קול');
}
async function preview() {
  $('preview').disabled = true;
  write('preview-status', 'מחכה לתשובה מהספק…');
  write('answer', '');
  $('audio').hidden = true;
  $('audio').removeAttribute('src');
  try {
    const mode = $('mode').value;
    const data = await api('preview', 'POST', { mode, key:$('key').value, text:$('sample').value,
      model:$('preview-choice').value, voice:$('preview-choice').value, prompt:$('prompt').value,
      ...(mode === 'inworld' ? {language:$('preview-language').value, ttsModel:$('preview-tts-model').value} : {}) });
    write('preview-status', data.ms + ' אלפיות שנייה' + (data.usage ?
      ' · קלט ' + (data.usage.prompt_tokens ?? '—') + ' · פלט ' + (data.usage.completion_tokens ?? '—') +
      (typeof data.usage.cost === 'number' ? ' · ' + money(data.usage.cost) : '') :
      data.characters ? ' · ' + data.characters + ' תווים' : ''));
    if (data.text) write('answer', data.text);
    if (data.audio) {
      $('audio').src = 'data:' + (data.mime || 'audio/mpeg') + ';base64,' + data.audio;
      $('audio').hidden = false;
      $('audio').play().catch(() => {});
    }
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
  $('save').scrollIntoView({block:'center'});
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
let currentChannel='yiddish';
const channelApi=(action)=>'channels/'+currentChannel+'/'+action;
async function loadChannels(){try{const data=await api('channels');options('channel-select',data.channels.map(c=>({id:c.id,name:c.name})),currentChannel);}catch(error){write('channel-status',error.message);}}
function showChannelSettings(settings){options('yiddish-voice',catalog.voices.yiddish,settings.voice);$('yiddish-model').value=settings.model;$('yiddish-prompt').value=settings.prompt;$('yiddish-greeting').value=settings.greeting;$('yiddish-wss').value=settings.wss;for(const id of ['yiddish-channel-token','yiddish-speech-key','yiddish-model-key'])$(id).value='';$('yiddish-channel-token').placeholder=settings.tokenConfigured?'אסימון שמור · ריק לשמירתו':'הזן אסימון';$('yiddish-speech-key').placeholder=settings.speechKeySaved?'מפתח שמור · ריק לשמירתו':'הזן מפתח API';$('yiddish-model-key').placeholder=settings.modelKeySaved?'מפתח שמור · ריק לשמירתו':'אופציונלי · מפתח השרת';$('yiddish-save').disabled=false;write('yiddish-status',(settings.configured?'ההגדרות נשמרו · יש לבדוק את החיבור':'נדרש אסימון ערוץ והגדרת ספקים')+(settings.lastError?' · תקלה אחרונה: '+settings.lastError:''));}
async function loadYiddish(){ $('yiddish-save').disabled=true;try{const settings=await api(channelApi('settings'));showChannelSettings(settings);}catch(error){write('yiddish-status',error.message);}}
$('channel-yiddish').onclick=()=>{$('yiddish-panel').hidden=false;if(catalog){loadChannels();loadYiddish();}$('yiddish-panel').scrollIntoView({behavior:'smooth'});};
$('channel-english').onclick=()=>{$('yiddish-panel').hidden=true;$('english-layout').scrollIntoView({behavior:'smooth'});};
$('channel-select').onchange=()=>{currentChannel=$('channel-select').value;$('channel-yiddish').click();};
$('create-channel').onclick=async()=>{try{const id=$('new-channel-id').value.trim();await api('channels','POST',{id,name:$('new-channel-name').value.trim()});currentChannel=id;await loadChannels();$('channel-yiddish').click();write('channel-status','הערוץ נוצר');}catch(error){write('channel-status',error.message);}};
$('copy-yiddish-wss').onclick=()=>{navigator.clipboard.writeText($('yiddish-wss').value).catch(()=>{$('yiddish-wss').select();});};
$('yiddish-save').onclick=async()=>{$('yiddish-save').disabled=true;try{const body={voice:$('yiddish-voice').value,model:$('yiddish-model').value,prompt:$('yiddish-prompt').value,greeting:$('yiddish-greeting').value};for(const [field,id] of [['token','yiddish-channel-token'],['speechKey','yiddish-speech-key'],['modelKey','yiddish-model-key']]){const value=$(id).value.trim();if(value)body[field]=value;}showChannelSettings(await api(channelApi('settings'),'PUT',body));}catch(error){write('yiddish-status',error.message);}finally{$('yiddish-save').disabled=false;}};
$('yiddish-listen').onclick=async()=>{$('yiddish-listen').disabled=true;write('yiddish-status','ממתין לספק…');try{const result=await api(channelApi('preview'),'POST',{text:$('channel-sample').value,voice:$('yiddish-voice').value});$('channel-audio').hidden=false;$('channel-audio').src='data:'+result.mime+';base64,'+result.audio;await $('channel-audio').play().catch(()=>{});write('yiddish-status','שמע התקבל · '+result.ms+' ms');}catch(error){write('yiddish-status',error.message);}finally{$('yiddish-listen').disabled=false;}};
(async () => {
  try {
    const settings = await api('settings');
    authorized = true;
    refresh();
    catalog = await api('catalog');
    applySettings(settings);
    loadChannels();
    updatePreview();
    $('preview').disabled = false;
    write('settings-status', 'ההגדרה הפעילה נטענה.');
  } catch (error) { write('access', error.message); }
})();
setInterval(refresh, 3000);
</script>
</html>`;

export function pilotSettingsPage(): Response {
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; media-src data:; frame-ancestors 'self'",
  } });
}
