# The dashboard is a self-contained HTML/JavaScript artifact; keeping its source lines
# intact makes the browser markup substantially easier to maintain.
# ruff: noqa: E501,F541

from __future__ import annotations


def dashboard_html() -> str:
    return f"""<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>לוח ההתקדמות והשליטה באנגלית</title>
  <style>
    :root {{ color-scheme:light; --ink:#172033; --muted:#667085; --card:#fff; --brand:#6d5ce7;
      --brand2:#9d7bea; --good:#18865b; --bad:#b42318; --line:#e8e7f2; --soft:#f7f5ff; }}
    * {{ box-sizing:border-box }} body {{ margin:0; font-family:Arial,"Noto Sans Hebrew",sans-serif;
      color:var(--ink); background:linear-gradient(145deg,#f7f5ff,#f4fbff 55%,#fff8ef); min-height:100vh; }}
    .wrap {{ width:min(1180px,calc(100% - 28px)); margin:0 auto; padding:18px 0 60px; }}
    .topbar {{ position:sticky; top:10px; z-index:50; margin-bottom:30px; border:1px solid rgba(221,217,241,.9);
      border-radius:17px; background:rgba(255,255,255,.92); box-shadow:0 12px 36px rgba(55,45,108,.13); backdrop-filter:blur(14px); }}
    .topbar-inner {{ display:flex; align-items:center; gap:13px; min-height:62px; padding:8px 10px; }}
    .brand {{ display:flex; align-items:center; gap:9px; padding:0 7px; white-space:nowrap; color:var(--ink); text-decoration:none; font-weight:850; }}
    .brand-mark {{ display:grid; place-items:center; width:34px; height:34px; border-radius:11px; color:white;
      background:linear-gradient(135deg,var(--brand),var(--brand2)); box-shadow:0 6px 16px rgba(109,92,231,.28); }}
    .profile-switch {{ display:flex; align-items:center; gap:7px; min-width:165px; }} .profile-switch label {{ margin:0; white-space:nowrap; }}
    .profile-switch select {{ padding:8px 9px; min-width:125px; border-color:#cfc8ef; background:#faf9ff; font-weight:700; }}
    .nav-links {{ display:flex; align-items:center; gap:4px; min-width:0; overflow-x:auto; scrollbar-width:none; flex:1; }}
    .nav-links::-webkit-scrollbar {{ display:none; }} .nav-link {{ flex:0 0 auto; padding:9px 11px; border-radius:10px;
      color:#5d6475; text-decoration:none; font-size:13px; font-weight:700; transition:.15s ease; }}
    .nav-link:hover,.nav-link:focus-visible,.nav-link.active {{ color:#4938bd; background:#f0edff; outline:none; }}
    .top-actions {{ display:flex; gap:6px; }} .top-actions button {{ padding:9px 12px; font-size:12px; white-space:nowrap; }}
    header {{ display:flex; justify-content:space-between; gap:18px; align-items:end; margin-bottom:22px; }}
    .page-hero {{ padding:5px 5px 0; scroll-margin-top:92px; }}
    h1 {{ margin:0; font-size:clamp(27px,5vw,43px); letter-spacing:-1px; }} h2 {{ margin:0 0 15px; font-size:21px; }}
    h3 {{ margin:22px 0 10px; font-size:17px; }} .sub,.muted {{ color:var(--muted); }} .sub {{ margin:7px 0 0; }}
    .actions {{ display:flex; gap:8px; flex-wrap:wrap; }} button {{ border:0; border-radius:12px; padding:11px 17px;
      font-weight:700; cursor:pointer; background:var(--brand); color:white; }} button.secondary {{ background:#eeeafd; color:#4e3fc2; }}
    button.danger {{ background:#fff0ee; color:var(--bad); }} button:disabled {{ opacity:.55; cursor:wait; }}
    .stats {{ display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:18px; }}
    .card {{ background:rgba(255,255,255,.94); border:1px solid var(--line); border-radius:20px;
      box-shadow:0 10px 35px rgba(67,55,125,.08); padding:20px; margin-bottom:18px; }}
    .stats .card {{ position:relative; overflow:hidden; border-top:3px solid var(--brand2); }}
    .stats .card:nth-child(2) {{ border-top-color:#42a5a0; }} .stats .card:nth-child(3) {{ border-top-color:#e4a34b; }}
    .stats .card:nth-child(4) {{ border-top-color:#e47b9d; }}
    .label {{ color:var(--muted); font-size:14px; }} .value {{ font-size:29px; font-weight:800; margin-top:8px; }}
    .grid {{ display:grid; grid-template-columns:1fr 2fr; gap:18px; align-items:start; }}
    .form-grid {{ display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }} .span2 {{ grid-column:span 2; }} .span3 {{ grid-column:1/-1; }}
    label {{ display:block; font-size:13px; color:var(--muted); margin-bottom:5px; }} input,select,textarea {{ width:100%;
      border:1px solid #d8d5e8; border-radius:11px; padding:10px 11px; font:inherit; color:var(--ink); background:#fff; }}
    .field-label {{ display:flex; align-items:center; gap:6px; min-height:20px; }}
    .help-tip {{ position:relative; display:inline-grid; place-items:center; width:18px; height:18px; flex:0 0 18px;
      border:1px solid #b9b3dc; border-radius:50%; color:#5547bc; background:#f4f1ff; font-size:12px; font-weight:800;
      cursor:help; outline:none; }}
    .help-tip::after {{ content:attr(data-help); position:absolute; z-index:30; right:-8px; bottom:calc(100% + 8px);
      width:min(290px,75vw); padding:10px 12px; border-radius:10px; background:#172033; color:#fff; box-shadow:0 8px 28px rgba(23,32,51,.25);
      font-size:12px; font-weight:400; line-height:1.55; text-align:right; direction:rtl; opacity:0; visibility:hidden;
      transform:translateY(4px); transition:opacity .15s,transform .15s,visibility .15s; pointer-events:none; }}
    .help-tip:hover::after,.help-tip:focus::after,.help-tip:focus-visible::after {{ opacity:1; visibility:visible; transform:translateY(0); }}
    textarea {{ min-height:92px; resize:vertical; line-height:1.5; direction:auto; }} textarea.large {{ min-height:240px; font-family:Consolas,monospace; font-size:13px; }}
    .check {{ display:flex; align-items:center; gap:9px; padding-top:23px; }} .check input {{ width:auto; }} .check label {{ margin:0; color:var(--ink); }}
    .section-note {{ background:#faf9ff; border-right:4px solid var(--brand2); padding:10px 12px; border-radius:8px; color:var(--muted); font-size:13px; line-height:1.55; }}
    .section-note.warning {{ border-right-color:#e3a23c; background:#fff9ec; color:#725018; }}
    .anchor-section {{ scroll-margin-top:92px; }} .management-card {{ padding:22px; border-color:#dcd7f4;
      background:linear-gradient(155deg,rgba(255,255,255,.98),rgba(248,246,255,.94)); }}
    .management-head {{ display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:13px; }}
    .management-head h2 {{ margin:0; }} .management-badge {{ border-radius:999px; padding:6px 10px; background:#eaf8f2;
      color:#13724e; font-size:12px; font-weight:750; white-space:nowrap; }}
    .management-section {{ margin-top:16px; padding:17px; border:1px solid #e5e1f4; border-radius:16px; background:rgba(255,255,255,.78); scroll-margin-top:92px; }}
    .management-section h3 {{ margin:0 0 12px; display:flex; align-items:center; gap:8px; }}
    .management-section h3::before {{ content:""; width:8px; height:8px; border-radius:50%; background:var(--brand2); box-shadow:0 0 0 5px #f0edff; }}
    .skill {{ margin:13px 0; }} .skill-head,.session-title,.save-row {{ display:flex; justify-content:space-between; gap:14px; align-items:center; }}
    .bar {{ height:9px; border-radius:20px; background:#eeeefa; overflow:hidden; margin-top:7px; }}
    .bar span {{ display:block; height:100%; background:linear-gradient(90deg,var(--brand),var(--brand2)); }}
    .session {{ border-top:1px solid var(--line); padding:18px 0; }} .session:first-of-type {{ border-top:0; padding-top:0; }}
    .points {{ color:var(--good); font-weight:800; white-space:nowrap; }} .summary {{ margin:11px 0; line-height:1.55; }}
    .meta {{ display:flex; flex-wrap:wrap; gap:8px; color:var(--muted); font-size:13px; }} .pill {{ background:#f5f3ff; border-radius:999px; padding:5px 9px; }}
    .note {{ margin-top:14px; color:var(--muted); font-size:12px; line-height:1.5; }} .empty {{ color:var(--muted); text-align:center; padding:28px 0; }}
    pre {{ direction:ltr; text-align:left; white-space:pre-wrap; overflow-wrap:anywhere; background:#121827; color:#e7ebff; padding:16px;
      border-radius:13px; max-height:520px; overflow:auto; font-size:12px; line-height:1.45; }} details {{ margin-top:12px; }} summary {{ cursor:pointer; font-weight:700; }}
    .status {{ min-height:20px; color:var(--good); font-size:13px; }} .status.error {{ color:var(--bad); }}
    .diagnostic-list {{ display:grid; gap:8px; margin-top:14px; }} .diagnostic-event {{ display:grid;
      grid-template-columns:155px 190px 1fr; gap:10px; align-items:start; padding:11px 12px; border:1px solid var(--line); border-radius:12px; background:#fbfbfe; font-size:12px; }}
    .diagnostic-event.warn {{ border-color:#efc8c3; background:#fff7f6; }} .event-name {{ font-weight:800; color:#4d3fc0; }}
    .event-details {{ direction:ltr; text-align:left; overflow-wrap:anywhere; color:var(--muted); font-family:Consolas,monospace; }}
    .trace-card {{ border:1px solid var(--line); border-radius:16px; padding:14px; margin-top:12px; background:#fbfbfe; }}
    .trace-head {{ display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }}
    .turn-log {{ display:grid; grid-template-columns:90px 1fr; gap:10px; padding:9px 0; border-top:1px solid var(--line); }}
    .turn-log b {{ color:#4d3fc0; }} .turn-log.output b {{ color:#08745a; }}
    .latency-grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:8px; margin-top:10px; }}
    .latency-item {{ padding:9px; border-radius:10px; background:#f0eefb; direction:ltr; text-align:left; font-size:12px; }}
    .login {{ position:fixed; inset:0; display:grid; place-items:center; padding:20px; background:rgba(24,24,45,.36); backdrop-filter:blur(7px); z-index:20; }}
    .login-box {{ width:min(420px,100%); background:white; padding:28px; border-radius:24px; box-shadow:0 30px 90px rgba(25,22,55,.25); }}
    .login-box h2 {{ font-size:25px; }} .error {{ min-height:20px; color:var(--bad); font-size:14px; }} [hidden] {{ display:none!important; }}
    @media(max-width:850px) {{ .wrap {{ width:min(100% - 18px,1180px); padding-top:9px; }} .topbar {{ top:5px; margin-bottom:22px; }}
      .topbar-inner {{ flex-wrap:wrap; gap:6px; }} .brand {{ flex:1; }} .nav-links {{ order:3; flex-basis:100%; border-top:1px solid var(--line); padding-top:5px; }}
      .profile-switch {{ order:2; flex:1 1 100%; }}
      .top-actions button {{ padding:8px 10px; }} .stats {{ grid-template-columns:repeat(2,1fr) }} .grid,.form-grid {{ grid-template-columns:1fr }}
      .span2,.span3 {{ grid-column:auto }} header {{ align-items:start; flex-direction:column; }} .management-card {{ padding:14px; }}
      .management-section {{ padding:14px; }} .management-head {{ align-items:flex-start; flex-direction:column; }}
      .diagnostic-event {{ grid-template-columns:1fr; gap:4px; }} }}
  </style>
</head>
<body>
  <main class="wrap">
    <nav class="topbar" aria-label="ניווט ראשי"><div class="topbar-inner">
      <a class="brand" href="#overview"><span class="brand-mark">ET</span><span>English Teacher</span></a>
      <div class="profile-switch"><label for="profileSelect">מורה:</label><select id="profileSelect" aria-label="בחירת פרופיל מורה"></select></div>
      <div class="nav-links">
        <a class="nav-link active" href="#overview">סקירה</a><a class="nav-link" href="#history-section">סיכומי שיחות</a>
        <a class="nav-link" href="#controlForm">ניהול</a><a class="nav-link" href="#speech-settings">דיבור ו־VAD</a>
        <a class="nav-link" href="#transcription-settings">תמלול</a><a class="nav-link" href="#ai-preview">מה נשלח ל־AI</a>
        <a class="nav-link" href="#diagnostics">יומן טכני</a><a class="nav-link" href="#conversation-logs">קלט, פלט ומהירות</a>
      </div>
      <div class="top-actions"><button id="refresh" class="secondary" type="button">רענון</button><button id="logout" class="secondary" type="button">יציאה</button></div>
    </div></nav>
    <header id="overview" class="page-hero anchor-section"><div><h1>התקדמות ושליטה במורה</h1><p class="sub">שיעורים, ניקוד, עלות והגדרות Gemini לשיחה הבאה</p></div></header>
    <section class="stats">
      <div class="card"><div class="label">סה״כ נקודות</div><div class="value" id="points">—</div></div>
      <div class="card"><div class="label">סה״כ שיחות</div><div class="value" id="sessions">—</div></div>
      <div class="card"><div class="label">דקות תרגול</div><div class="value" id="minutes">—</div></div>
      <div class="card"><div class="label">עלות Gemini משוערת</div><div class="value" id="cost">—</div></div>
    </section>
    <details class="card anchor-section" id="create-bot">
      <summary><strong>יצירת בוט חדש</strong> — הגדרה דינמית עם כתובת WebSocket משלו</summary>
      <div class="form-grid" style="margin-top:16px">
        <div><label for="new_bot_id">מזהה באנגלית</label><input id="new_bot_id" placeholder="sales-agent"></div>
        <div><label for="new_bot_label">שם לתצוגה</label><input id="new_bot_label" placeholder="נציג מכירות"></div>
        <div><label for="new_bot_role">תפקיד</label><select id="new_bot_role"><option value="teacher">מורה</option><option value="translator">תרגומון</option><option value="sales">מכירות</option><option value="service">שירות</option><option value="custom">אחר</option></select></div>
        <div><label for="new_bot_channel">מזהה ערוץ טכנוליין</label><input id="new_bot_channel" placeholder="אפשר להשאיר ריק"></div>
        <div class="span3"><button type="button" id="createBot">יצירת הבוט</button><span id="createBotStatus" class="status"></span></div>
      </div>
    </details>
    <section class="grid anchor-section" id="history-section">
      <aside class="card"><h2>מיומנויות</h2><div id="skills" class="empty">עדיין אין ציונים</div>
        <p class="note">הציונים הם הערכת המורה במהלך התרגול ואינם ציון בית־ספרי.</p></aside>
      <section class="card"><h2>סיכומי שיחות</h2><div id="history" class="empty">עדיין אין שיחות שמורות</div>
        <p class="note">העלות היא אומדן לפי נתוני Gemini; החיוב בחשבון Google הוא הקובע.</p></section>
    </section>

    <form class="card management-card anchor-section" id="controlForm">
      <div class="management-head"><div><h2>שליטה בשיעור הבא</h2><p class="sub" id="activeProfileLabel"></p></div><span class="management-badge">חל מהשיחה החדשה הבאה</span></div>
      <p class="section-note">השינויים נשמרים מיידית במסד הנתונים וחלים על שיחה חדשה. הם אינם משנים שיחה שכבר מחוברת.</p>
      <p class="section-note warning" id="channelNotice" hidden></p>
      <section class="management-section" id="identity-settings"><h3>זהות, ניתוב וגרסה</h3>
      <div class="form-grid">
        <div><label for="bot_label">שם הבוט</label><input id="bot_label"></div>
        <div><label for="bot_role">תפקיד</label><select id="bot_role"><option value="teacher">מורה</option><option value="translator">תרגומון</option><option value="sales">מכירות</option><option value="service">שירות</option><option value="custom">אחר</option></select></div>
        <div><label for="bot_audience">קהל</label><input id="bot_audience" placeholder="general"></div>
        <div><label for="bot_channel_id">מזהה ערוץ טכנוליין</label><input id="bot_channel_id"></div>
        <div class="span2"><label for="bot_description">תיאור</label><textarea id="bot_description"></textarea></div>
        <div><label for="bot_endpoint">כתובת WebSocket</label><input id="bot_endpoint" readonly dir="ltr"></div>
        <div class="check"><input id="bot_enabled" type="checkbox"><label for="bot_enabled">הבוט פעיל ומקבל שיחות</label></div>
        <div><label>גרסה פעילה</label><strong id="bot_version">—</strong></div>
      </div></section>
      <section class="management-section" id="behavior-settings"><h3>מטרות והתנהגות</h3>
      <div class="form-grid">
        <div class="span2"><label for="learning_goal">מטרת הלמידה העדכנית</label><textarea id="learning_goal" placeholder="לדוגמה: לנהל שיחה קצרה בחנות ולתרגל מספרים ומחירים"></textarea></div>
        <div><label for="target_lesson_minutes">משך יעד לשיעור בדקות</label><input id="target_lesson_minutes" type="number" min="1" max="120"></div>
        <div><label for="ending_policy">מי מחליט לסיים</label><select id="ending_policy"><option value="learner_only">רק התלמידה</option><option value="after_target_with_permission">אחרי זמן היעד ובאישור</option><option value="model_discretion">שיקול דעת המורה</option></select></div>
        <div><label for="max_call_minutes">מגבלת שיחה טכנית בדקות</label><input id="max_call_minutes" type="number" min="1" max="120"></div>
        <div><label for="temperature">יצירתיות 0–2, ריק = ברירת Gemini</label><input id="temperature" type="number" min="0" max="2" step="0.1"></div>
        <div class="span3"><label for="custom_instructions">הוראות הורה נוספות</label><textarea id="custom_instructions" placeholder="כל הוראה פדגוגית נוספת שתרצה להעביר למורה"></textarea></div>
        <div class="span3"><label for="opening_message">הודעת הפתיחה שנשלחת ל־AI</label><textarea id="opening_message"></textarea></div>
        <div class="span3"><label for="base_prompt">פרומפט המערכת הבסיסי — מצב מתקדם</label><textarea id="base_prompt" class="large"></textarea></div>
      </div>
      </section>

      <section class="management-section" id="speech-settings"><h3>קול וזיהוי דיבור</h3>
      <p class="section-note">בשדות הרגישות Gemini מציע רשמית רק שתי דרגות: גבוהה או נמוכה. כוונון מספרי עדין יותר נעשה באמצעות זמני אישור ההתחלה והשקט לסיום. העבירו את הסמן מעל סימן השאלה — או עברו אליו במקלדת — לקבלת הסבר.</p>
      <div class="form-grid">
        <div><label class="field-label" for="voice">קול <span class="help-tip" tabindex="0" role="note" aria-label="משנה את הקול שבו המורה נשמעת. אינו משנה את מהירות הדיבור." data-help="משנה את הקול שבו המורה נשמעת. אינו משנה את מהירות הדיבור.">?</span></label><select id="voice"></select></div>
        <div><label for="model">מודל Gemini לבוט</label><input id="model" dir="ltr" maxlength="200"></div>
        <div><label class="field-label" for="language_code">שפת הפלט שנשלחת ל־Google <span class="help-tip" tabindex="0" role="note" aria-label="קוד השפה של הדיבור שמייצרת המורה, למשל he-IL. ההוראות בפרומפט עדיין קובעות מתי לדבר עברית ומתי אנגלית." data-help="קוד השפה של הדיבור שמייצרת המורה, למשל he-IL. ההוראות בפרומפט עדיין קובעות מתי לדבר עברית ומתי אנגלית.">?</span></label><input id="language_code" maxlength="20"></div>
        <div><label class="field-label" for="input_batch_frames">צבירת קלט: מסגרות × 20ms <span class="help-tip" tabindex="0" role="note" aria-label="כמה אודיו השרת אוסף לפני שליחה ל-Gemini. לדוגמה 5 פירושו 100 מילישניות. ערך נמוך שולח מהר יותר; ערך גבוה מפחית את מספר ההודעות אך מוסיף מעט השהיה." data-help="כמה אודיו השרת אוסף לפני שליחה ל־Gemini. לדוגמה 5 פירושו 100 מ״ש. ערך נמוך שולח מהר יותר; ערך גבוה מפחית את מספר ההודעות אך מוסיף מעט השהיה.">?</span></label><input id="input_batch_frames" type="number" min="1" max="20"></div>
        <div><label class="field-label" for="vad_start_sensitivity">רגישות התחלת דיבור <span class="help-tip" tabindex="0" role="note" aria-label="גבוהה מזהה התחלת דיבור לעיתים קרובות יותר, כולל קול חלש אך גם רעשים ונשימות. נמוכה דורשת אות ברור יותר ומפחיתה קטיעות שווא." data-help="גבוהה מזהה התחלת דיבור לעיתים קרובות יותר, כולל קול חלש אך גם רעשים ונשימות. נמוכה דורשת אות ברור יותר ומפחיתה קטיעות שווא.">?</span></label><select id="vad_start_sensitivity"></select></div>
        <div><label class="field-label" for="vad_end_sensitivity">רגישות סיום דיבור <span class="help-tip" tabindex="0" role="note" aria-label="גבוהה קובעת סוף דיבור לעיתים קרובות יותר. נמוכה פחות ממהרת לסיים את תור התלמידה. זמן השקט המספרי שלמטה הוא הכוונון המדויק יותר." data-help="גבוהה קובעת סוף דיבור לעיתים קרובות יותר. נמוכה פחות ממהרת לסיים את תור התלמידה. זמן השקט המספרי שלמטה הוא הכוונון המדויק יותר.">?</span></label><select id="vad_end_sensitivity"></select></div>
        <div><label class="field-label" for="vad_prefix_ms">אישור התחלת דיבור במ״ש <span class="help-tip" tabindex="0" role="note" aria-label="כמה זמן צריך לזהות דיבור לפני ש-Gemini מאשר שהדיבור התחיל. ערך גבוה מסנן נשימות ורעשים טוב יותר, אך עלול להגיב מאוחר יותר לדיבור קצר." data-help="כמה זמן צריך לזהות דיבור לפני ש־Gemini מאשר שהדיבור התחיל. ערך גבוה מסנן נשימות ורעשים טוב יותר, אך עלול להגיב מאוחר יותר לדיבור קצר.">?</span></label><input id="vad_prefix_ms" type="number" min="0" max="1000"></div>
        <div><label class="field-label" for="vad_silence_ms">שקט לסיום משפט במ״ש <span class="help-tip" tabindex="0" role="note" aria-label="כמה זמן של שקט נדרש כדי לקבוע שהתלמידה סיימה. ערך גבוה מאפשר לחשוב ולעצור באמצע משפט, אך מגדיל את ההמתנה לפני תשובת המורה." data-help="כמה זמן של שקט נדרש כדי לקבוע שהתלמידה סיימה. ערך גבוה מאפשר לחשוב ולעצור באמצע משפט, אך מגדיל את ההמתנה לפני תשובת המורה.">?</span></label><input id="vad_silence_ms" type="number" min="100" max="2000"></div>
        <div><label class="field-label" for="activity_handling">כשהתלמידה מתחילה לדבר <span class="help-tip" tabindex="0" role="note" aria-label="אפשר לבחור אם דיבור שזוהה קוטע מיד את תשובת המורה או שהמורה ממשיכה לדבר. אם רעשים קוטעים את המורה, רגישות התחלה נמוכה היא בדרך כלל התיקון הראשון." data-help="אפשר לבחור אם דיבור שזוהה קוטע מיד את תשובת המורה או שהמורה ממשיכה לדבר. אם רעשים קוטעים את המורה, רגישות התחלה נמוכה היא בדרך כלל התיקון הראשון.">?</span></label><select id="activity_handling"></select></div>
        <div><label class="field-label" for="turn_coverage">האודיו שנכלל בתור <span class="help-tip" tabindex="0" role="note" aria-label="רק פעילות שולח לתור בעיקר את קטעי הדיבור שזוהו. כל הקלט כולל גם שקט ורקע. בדרך כלל רק פעילות מתאים יותר לשיחת טלפון." data-help="„רק פעילות” שולח לתור בעיקר את קטעי הדיבור שזוהו. „כל הקלט” כולל גם שקט ורקע. בדרך כלל „רק פעילות” מתאים יותר לשיחת טלפון.">?</span></label><select id="turn_coverage"></select></div>
      </div>
      </section>

      <section class="management-section" id="transcription-settings"><h3>תמלול והקשר</h3>
      <div class="form-grid">
        <div><label class="field-label" for="transcription_mode">מצב תמלול <span class="help-tip" tabindex="0" role="note" aria-label="מילולי שומר את הנאמר קרוב ככל האפשר למקור. חכם עשוי לנקות ולנרמל את הטקסט. זה משפיע על התמליל, לא על איכות האודיו עצמו." data-help="„מילולי” שומר את הנאמר קרוב ככל האפשר למקור. „חכם” עשוי לנקות ולנרמל את הטקסט. זה משפיע על התמליל, לא על איכות האודיו עצמו.">?</span></label><select id="transcription_mode"></select></div>
        <div><label class="field-label" for="transcription_language_codes">רמזי שפה, מופרדים בפסיק <span class="help-tip" tabindex="0" role="note" aria-label="רשימת השפות הצפויות בתמלול, למשל he-IL,en-US. אלו רמזים למזהה הדיבור ואינם הוראה למורה באיזו שפה לדבר." data-help="רשימת השפות הצפויות בתמלול, למשל he-IL,en-US. אלו רמזים למזהה הדיבור ואינם הוראה למורה באיזו שפה לדבר.">?</span></label><input id="transcription_language_codes" placeholder="he-IL,en-US"></div>
        <div class="check"><input id="store_transcripts" type="checkbox"><label for="store_transcripts">לשמור תמלילים מלאים (רגיש לפרטיות)</label></div>
        <div class="span2"><label for="custom_vocabulary">אוצר מילים מותאם, מונח אחד בכל שורה</label><textarea id="custom_vocabulary"></textarea></div>
        <div><label for="context_trigger_tokens">סף דחיסת הקשר</label><input id="context_trigger_tokens" type="number" min="1000" max="120000"></div>
        <div><label for="context_target_tokens">יעד לאחר דחיסה</label><input id="context_target_tokens" type="number" min="500" max="100000"></div>
      </div>
      </section>
      <div class="save-row"><div id="saveStatus" class="status"></div><div class="actions"><button type="button" id="reset" class="danger">איפוס לברירות המחדל</button><button type="submit" id="save">שמירת הגדרות</button></div></div>
    </form>

    <section class="card anchor-section" id="ai-preview">
      <h2>מה נשלח בפועל ל־AI</h2>
      <p class="section-note">התצוגה מתעדכנת לאחר שמירה וכוללת את הפרומפט הבסיסי, מטרת השיעור, מדיניות הסיום, סך הנקודות מכל השיחות, צעדי ההמשך והיסטוריית הלמידה המצומצמת.</p>
      <h3>System instruction האפקטיבי</h3><pre id="effectivePrompt">טוען…</pre>
      <details><summary>הודעת הפתיחה המדויקת</summary><pre id="openingPayload"></pre></details>
      <details><summary>כל הודעת ה־setup המדויקת ל־Gemini</summary><pre id="setupPayload"></pre></details>
      <details><summary>פרטים קבועים שאינם ניתנים לשינוי דינמי</summary><pre id="runtimePayload"></pre></details>
    </section>

    <section class="card anchor-section" id="diagnostics">
      <div class="management-head"><div><h2>יומן טכני</h2><p class="sub">אירועי שיחה ותורים בלבד — ללא אודיו וללא תוכן התמליל.</p></div><button type="button" class="secondary" id="refreshDiagnostics">רענון יומן</button></div>
      <p class="section-note">היומן נועד לזהות חיבור כפול, תגובה ללא תור תלמידה, קטיעה וקריאות כלי. הוא שומר מטא־נתונים קטנים בלבד ואינו רושם כל חבילת אודיו.</p>
      <div id="diagnosticList" class="diagnostic-list empty">עדיין אין אירועים לפרופיל הזה.</div>
    </section>
    <section class="card anchor-section" id="conversation-logs">
      <div class="management-head"><div><h2>מה התקבל, מה נשלח ומדדי מהירות</h2><p class="sub">הפרומפט המדויק, תמלילי שני הצדדים וציר הזמן של כל שיחה</p></div><button type="button" class="secondary" id="refreshTraces">רענון לוגים</button></div>
      <p class="section-note">כל שיחה מקבלת טביעת פרומפט וגרסה. מדדי ההשהיה נמדדים מתחילת החיבור ובין אירועים עוקבים, כדי לזהות עיכוב בטכנוליין, בחיבור ל־Gemini, בזיהוי הדיבור או ביצירת האודיו.</p>
      <div id="traceList" class="empty">עדיין אין שיחות מתועדות בפרופיל הזה.</div>
    </section>
  </main>
  <section class="login" id="login"><form class="login-box" id="loginForm"><h2>כניסה ללוח ההורה</h2>
    <p class="sub">הזינו את סיסמת המנהל המוגדרת ב־Render.</p><input id="token" type="password" autocomplete="current-password" placeholder="סיסמת מנהל" required>
    <div class="error" id="error"></div><button type="submit">כניסה</button></form></section>
  <script>
    const profilesEndpoint="/v1/admin/profiles"; const $=id=>document.getElementById(id);
    let profiles=[],currentProfile=sessionStorage.getItem("tutorProfile")||"";
    const progressEndpoint=()=>"/v1/progress/"+encodeURIComponent(currentProfile);
    const configEndpoint=()=>"/v1/admin/config/"+encodeURIComponent(currentProfile);
    const diagnosticsEndpoint=()=>"/v1/admin/diagnostics/"+encodeURIComponent(currentProfile);
    const tracesEndpoint=()=>"/v1/admin/traces/"+encodeURIComponent(currentProfile);
    const botEndpoint=()=>"/v1/admin/bots/"+encodeURIComponent(currentProfile);
    const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}}[c]));
    const money=n=>n>0&&n<0.0001?"פחות מ־$0.0001":"$"+Number(n||0).toFixed(4);
    const auth=()=>({{Authorization:"Bearer "+sessionStorage.getItem("adminToken")}});
    const optionNames={{
      START_SENSITIVITY_LOW:"נמוכה — פחות רגישה לרעשים",START_SENSITIVITY_HIGH:"גבוהה — מזהה דיבור בקלות רבה יותר",
      END_SENSITIVITY_LOW:"נמוכה — פחות ממהרת לסיים",END_SENSITIVITY_HIGH:"גבוהה — מסיימת לעיתים קרובות יותר",
      START_OF_ACTIVITY_INTERRUPTS:"דיבור התלמידה קוטע את המורה",NO_INTERRUPTION:"המורה אינה נקטעת",
      TURN_COVERAGE_UNSPECIFIED:"ברירת המחדל של Gemini",TURN_INCLUDES_ONLY_ACTIVITY:"רק פעילות דיבור",
      TURN_INCLUDES_ALL_INPUT:"כל הקלט, כולל שקט",TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO:"פעילות אודיו וכל הווידאו",
      VERBATIM:"מילולי — קרוב למקור",SMART:"חכם — טקסט מנורמל"
    }};
    function fillSelect(id,values,current){{$(id).innerHTML=values.map(v=>`<option value="${{esc(v)}}">${{esc(optionNames[v]||v)}}</option>`).join("");$(id).value=current;}}
    function renderProgress(data){{$("points").textContent=data.total_points??0;$("sessions").textContent=data.session_count??0;
      $("minutes").textContent=data.total_minutes??0;$("cost").textContent=money(data.estimated_cost_usd);const skills=Object.entries(data.skill_averages||{{}});
      const names={{fluency:"שטף דיבור",grammar:"דקדוק",vocabulary:"אוצר מילים",pronunciation:"הגייה",comprehension:"הבנה"}};
      $("skills").className=skills.length?"":"empty";$("skills").innerHTML=skills.length?skills.map(([n,s])=>`<div class="skill"><div class="skill-head"><span>${{esc(names[n]||n)}}</span><strong>${{Number(s).toFixed(1)}}/5</strong></div><div class="bar"><span style="width:${{Math.min(100,Number(s)*20)}}%"></span></div></div>`).join(""):"עדיין אין ציונים";
      const rows=data.sessions||[];$("history").className=rows.length?"":"empty";$("history").innerHTML=rows.length?rows.map(r=>`<article class="session"><div class="session-title"><strong>${{esc(new Date(r.started_at).toLocaleString("he-IL"))}}</strong><span class="points">+${{Number(r.points||0)}} נקודות</span></div><p class="summary">${{esc(r.summary_he||"השיחה נשמרה ללא סיכום מילולי.")}}</p>${{r.success_he?`<p><b>מה הצליח:</b> ${{esc(r.success_he)}}</p>`:""}}${{r.next_step_he?`<p><b>הצעד הבא:</b> ${{esc(r.next_step_he)}}</p>`:""}}<div class="meta"><span class="pill">${{Math.round((r.duration_seconds||0)/60)}} דקות</span><span class="pill">${{r.learner_turns||0}} תשובות</span><span class="pill">עלות ${{money(r.estimated_cost_usd)}}</span></div></article>`).join(""):"עדיין אין שיחות שמורות";}}
    function renderConfig(data){{const c=data.controls,o=data.options,p=data.profile;$("activeProfileLabel").textContent=p.label;$("channelNotice").hidden=!!p.channel_configured;
      $("channelNotice").textContent=p.channel_configured?"":`כדי לקבל שיחות בפרופיל זה יש ליצור ערוץ סטרימינג בטכנוליין, להפנות אותו אל ${{p.websocket_path}}, ולהדביק כאן את מזהה הערוץ.`;
      $("bot_label").value=p.label||"";$("bot_role").value=p.role||"custom";$("bot_audience").value=p.audience||"general";$("bot_channel_id").value=p.channel_id||"";$("bot_description").value=p.description||"";$("bot_enabled").checked=!!p.enabled;$("bot_version").textContent=p.active_version??0;$("bot_endpoint").value=(location.origin.replace(/^http/,"ws")+p.websocket_path);
      ["learning_goal","custom_instructions","opening_message","base_prompt","model","language_code"].forEach(k=>$(k).value=c[k]??"");
      ["target_lesson_minutes","max_call_minutes","input_batch_frames","vad_prefix_ms","vad_silence_ms","context_trigger_tokens","context_target_tokens"].forEach(k=>$(k).value=c[k]);
      $("temperature").value=c.temperature??"";$("ending_policy").value=c.ending_policy;$("store_transcripts").checked=!!c.store_transcripts;
      $("transcription_language_codes").value=(c.transcription_language_codes||[]).join(",");$("custom_vocabulary").value=(c.custom_vocabulary||[]).join("\\n");
      fillSelect("voice",o.voices,c.voice);fillSelect("vad_start_sensitivity",o.vad_start_sensitivity,c.vad_start_sensitivity);fillSelect("vad_end_sensitivity",o.vad_end_sensitivity,c.vad_end_sensitivity);fillSelect("activity_handling",o.activity_handling,c.activity_handling);fillSelect("turn_coverage",o.turn_coverage,c.turn_coverage);fillSelect("transcription_mode",o.transcription_mode,c.transcription_mode);
      const setup=data.effective.setup_message;$("effectivePrompt").textContent=setup.setup.systemInstruction.parts[0].text;$("setupPayload").textContent=JSON.stringify(setup,null,2);$("openingPayload").textContent=JSON.stringify(data.effective.opening_client_message,null,2);$("runtimePayload").textContent=JSON.stringify({{...data.effective.read_only_runtime,prompt_fingerprint:data.effective.prompt_fingerprint}},null,2);}}
    const eventNames={{call_accepted:"השיחה התקבלה",duplicate_connection_rejected:"חיבור כפול נחסם",gemini_connected:"Gemini התחבר",greeting_requested:"הפתיחה הופעלה",tutor_turn_complete:"תגובת המורה הסתיימה",possible_unprompted_response:"תגובה ללא תמליל תלמיד",tutor_interrupted:"המורה נקטעה",tool_call:"קריאת כלי",session_saved:"השיחה נשמרה",call_lease_lost:"נעילת השיחה אבדה",call_failed:"שגיאת שיחה"}};
    function renderDiagnostics(data){{const rows=data.events||[];$("diagnosticList").className=rows.length?"diagnostic-list":"diagnostic-list empty";$("diagnosticList").innerHTML=rows.length?rows.map(event=>{{const warn=["duplicate_connection_rejected","possible_unprompted_response","call_lease_lost","call_failed"].includes(event.event_type);return `<div class="diagnostic-event${{warn?" warn":""}}"><time>${{esc(new Date(event.created_at).toLocaleString("he-IL"))}}</time><div><span class="event-name">${{esc(eventNames[event.event_type]||event.event_type)}}</span><br><span class="muted">${{esc(String(event.call_id||"").slice(0,14))}}</span></div><div class="event-details">${{esc(JSON.stringify(event.details||{{}}))}}</div></div>`;}}).join(""):"עדיין אין אירועים לפרופיל הזה.";}}
    function renderTraces(data){{const rows=data.traces||[];$("traceList").className=rows.length?"":"empty";$("traceList").innerHTML=rows.length?rows.map(trace=>{{const turns=(trace.turns||[]).map(turn=>`<div class="turn-log ${{esc(turn.direction)}}"><b>${{turn.direction==="input"?"התקבל":"הוחזר"}}</b><div>${{esc(turn.text)}}</div></div>`).join("")||"<p class='muted'>אין עדיין תמליל לשיחה זו.</p>";const latency=(trace.latency||[]).map(item=>`<div class="latency-item"><b>${{esc(item.event_name)}}</b><br>${{Number(item.since_call_start_ms).toFixed(0)}}ms מתחילת השיחה<br>+${{Number(item.since_previous_ms).toFixed(0)}}ms</div>`).join("");return `<details class="trace-card"><summary class="trace-head"><span><b>${{esc(new Date(trace.created_at).toLocaleString("he-IL"))}}</b> · גרסה ${{trace.bot_version}}</span><span>שיחה ${{esc(trace.call_id.slice(0,14))}} · ${{esc(trace.fingerprint.slice(0,12))}}</span></summary><h3>קלט ופלט</h3>${{turns}}<h3>ציר זמן</h3><div class="latency-grid">${{latency}}</div><details><summary>הפרומפט המדויק שנשלח</summary><pre>${{esc(trace.system_instruction)}}</pre></details><details><summary>הודעת Setup מלאה</summary><pre>${{esc(JSON.stringify(trace.setup_message,null,2))}}</pre></details></details>`;}}).join(""):"עדיין אין שיחות מתועדות בפרופיל הזה.";}}
    function renderProfiles(data){{profiles=data.profiles||[];if(!profiles.some(item=>item.id===currentProfile))currentProfile=profiles[0]?.id||"";$("profileSelect").innerHTML=profiles.map(item=>`<option value="${{esc(item.id)}}">${{esc(item.label)}}${{item.channel_configured?"":" — טרם חוברה שלוחה"}}</option>`).join("");$("profileSelect").value=currentProfile;sessionStorage.setItem("tutorProfile",currentProfile);}}
    function controlsFromForm(){{const integer=id=>Number.parseInt($(id).value,10),list=(id,separator)=>$(id).value.split(separator).map(x=>x.trim()).filter(Boolean);
      return {{base_prompt:$("base_prompt").value,opening_message:$("opening_message").value,learning_goal:$("learning_goal").value,custom_instructions:$("custom_instructions").value,target_lesson_minutes:integer("target_lesson_minutes"),ending_policy:$("ending_policy").value,voice:$("voice").value,model:$("model").value,language_code:$("language_code").value,temperature:$("temperature").value===""?null:Number($("temperature").value),vad_start_sensitivity:$("vad_start_sensitivity").value,vad_end_sensitivity:$("vad_end_sensitivity").value,vad_prefix_ms:integer("vad_prefix_ms"),vad_silence_ms:integer("vad_silence_ms"),activity_handling:$("activity_handling").value,turn_coverage:$("turn_coverage").value,input_batch_frames:integer("input_batch_frames"),transcription_mode:$("transcription_mode").value,transcription_language_codes:list("transcription_language_codes",","),custom_vocabulary:list("custom_vocabulary",/\\r?\\n/),store_transcripts:$("store_transcripts").checked,context_trigger_tokens:integer("context_trigger_tokens"),context_target_tokens:integer("context_target_tokens"),max_call_minutes:integer("max_call_minutes")}};}}
    async function request(url,options={{}}){{const response=await fetch(url,{{...options,headers:{{...auth(),...(options.headers||{{}})}},cache:"no-store"}});if(!response.ok){{let msg=response.status===401?"הסיסמה אינה נכונה":"הפעולה נכשלה";try{{const body=await response.json();msg=body.detail?JSON.stringify(body.detail):msg}}catch{{}}throw new Error(msg)}}return response.json();}}
    async function loadProfile(){{const [progress,config,diagnostics,traces]=await Promise.all([request(progressEndpoint()),request(configEndpoint()),request(diagnosticsEndpoint()),request(tracesEndpoint())]);renderProgress(progress);renderConfig(config);renderDiagnostics(diagnostics);renderTraces(traces);}}
    async function loadAll(token){{sessionStorage.setItem("adminToken",token);renderProfiles(await request(profilesEndpoint));await loadProfile();$("login").hidden=true;}}
    $("loginForm").addEventListener("submit",async e=>{{e.preventDefault();$("error").textContent="";try{{await loadAll($("token").value)}}catch(err){{$("error").textContent=err.message}}}});
    $("controlForm").addEventListener("submit",async e=>{{e.preventDefault();$("save").disabled=true;$("saveStatus").className="status";$("saveStatus").textContent="שומר ומפרסם גרסה חדשה…";try{{await request(botEndpoint(),{{method:"PUT",headers:{{"Content-Type":"application/json"}},body:JSON.stringify({{label:$("bot_label").value,role:$("bot_role").value,description:$("bot_description").value,audience:$("bot_audience").value,channel_id:$("bot_channel_id").value||null,enabled:$("bot_enabled").checked}})}});const data=await request(configEndpoint(),{{method:"PUT",headers:{{"Content-Type":"application/json"}},body:JSON.stringify(controlsFromForm())}});renderConfig(data);renderProfiles(await request(profilesEndpoint));$("saveStatus").textContent="גרסה חדשה פורסמה. היא תחול בשיחה הבאה בכל הערוצים."}}catch(err){{$("saveStatus").className="status error";$("saveStatus").textContent=err.message}}finally{{$("save").disabled=false}}}});
    $("reset").addEventListener("click",async()=>{{if(!confirm("לאפס את הגדרות המורה שנבחרה לברירות המחדל שלה?"))return;try{{renderConfig(await request(configEndpoint(),{{method:"DELETE"}}));$("saveStatus").textContent="הגדרות הפרופיל אופסו."}}catch(err){{$("saveStatus").className="status error";$("saveStatus").textContent=err.message}}}});
    $("profileSelect").addEventListener("change",async()=>{{currentProfile=$("profileSelect").value;sessionStorage.setItem("tutorProfile",currentProfile);$("saveStatus").textContent="טוען פרופיל…";try{{await loadProfile();$("saveStatus").textContent=""}}catch(err){{$("saveStatus").className="status error";$("saveStatus").textContent=err.message}}}});
    $("refreshDiagnostics").addEventListener("click",async()=>{{try{{renderDiagnostics(await request(diagnosticsEndpoint()))}}catch(err){{$("diagnosticList").className="status error";$("diagnosticList").textContent=err.message}}}});
    $("refreshTraces").addEventListener("click",async()=>{{try{{renderTraces(await request(tracesEndpoint()))}}catch(err){{$("traceList").className="status error";$("traceList").textContent=err.message}}}});
    $("createBot").addEventListener("click",async()=>{{$("createBotStatus").className="status";$("createBotStatus").textContent="יוצר…";try{{const body={{id:$("new_bot_id").value,label:$("new_bot_label").value,role:$("new_bot_role").value,channel_id:$("new_bot_channel").value||null,enabled:true,audience:"general",description:""}};await request("/v1/admin/bots",{{method:"POST",headers:{{"Content-Type":"application/json"}},body:JSON.stringify(body)}});renderProfiles(await request(profilesEndpoint));currentProfile=body.id;$("profileSelect").value=currentProfile;sessionStorage.setItem("tutorProfile",currentProfile);await loadProfile();$("createBotStatus").textContent="הבוט נוצר ונבחר."}}catch(err){{$("createBotStatus").className="status error";$("createBotStatus").textContent=err.message}}}});
    $("refresh").addEventListener("click",()=>loadAll(sessionStorage.getItem("adminToken")).catch(()=>$("login").hidden=false));
    $("logout").addEventListener("click",()=>{{sessionStorage.removeItem("adminToken");$("token").value="";$("login").hidden=false}});
    const navLinks=[...document.querySelectorAll(".nav-link")];
    function activateNav(link){{navLinks.forEach(item=>item.classList.toggle("active",item===link));}}
    navLinks.forEach(link=>link.addEventListener("click",()=>activateNav(link)));
    if("IntersectionObserver" in window){{const observer=new IntersectionObserver(entries=>{{
      const visible=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
      if(visible){{const link=navLinks.find(item=>item.getAttribute("href")==="#"+visible.target.id);if(link)activateNav(link);}}
    }},{{rootMargin:"-15% 0px -70% 0px",threshold:[0,.1,.4]}});navLinks.forEach(link=>{{const target=document.querySelector(link.getAttribute("href"));if(target)observer.observe(target);}});}}
    const saved=sessionStorage.getItem("adminToken");if(saved)loadAll(saved).catch(()=>{{sessionStorage.removeItem("adminToken");$("login").hidden=false}});
  </script>
</body></html>"""
