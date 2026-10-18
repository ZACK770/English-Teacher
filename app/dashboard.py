# The dashboard is a self-contained HTML/JavaScript artifact; keeping its source lines
# intact makes the browser markup substantially easier to maintain.
# ruff: noqa: E501

from __future__ import annotations

import json


def dashboard_html(student_id: str) -> str:
    progress_endpoint = json.dumps(f"/v1/progress/{student_id}")
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
    .wrap {{ width:min(1180px,calc(100% - 28px)); margin:0 auto; padding:30px 0 60px; }}
    header {{ display:flex; justify-content:space-between; gap:18px; align-items:end; margin-bottom:22px; }}
    h1 {{ margin:0; font-size:clamp(27px,5vw,43px); letter-spacing:-1px; }} h2 {{ margin:0 0 15px; font-size:21px; }}
    h3 {{ margin:22px 0 10px; font-size:17px; }} .sub,.muted {{ color:var(--muted); }} .sub {{ margin:7px 0 0; }}
    .actions {{ display:flex; gap:8px; flex-wrap:wrap; }} button {{ border:0; border-radius:12px; padding:11px 17px;
      font-weight:700; cursor:pointer; background:var(--brand); color:white; }} button.secondary {{ background:#eeeafd; color:#4e3fc2; }}
    button.danger {{ background:#fff0ee; color:var(--bad); }} button:disabled {{ opacity:.55; cursor:wait; }}
    .stats {{ display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:18px; }}
    .card {{ background:rgba(255,255,255,.92); border:1px solid var(--line); border-radius:20px;
      box-shadow:0 10px 35px rgba(67,55,125,.08); padding:20px; margin-bottom:18px; }}
    .label {{ color:var(--muted); font-size:14px; }} .value {{ font-size:29px; font-weight:800; margin-top:8px; }}
    .grid {{ display:grid; grid-template-columns:1fr 2fr; gap:18px; align-items:start; }}
    .form-grid {{ display:grid; grid-template-columns:repeat(3,1fr); gap:14px; }} .span2 {{ grid-column:span 2; }} .span3 {{ grid-column:1/-1; }}
    label {{ display:block; font-size:13px; color:var(--muted); margin-bottom:5px; }} input,select,textarea {{ width:100%;
      border:1px solid #d8d5e8; border-radius:11px; padding:10px 11px; font:inherit; color:var(--ink); background:#fff; }}
    textarea {{ min-height:92px; resize:vertical; line-height:1.5; direction:auto; }} textarea.large {{ min-height:240px; font-family:Consolas,monospace; font-size:13px; }}
    .check {{ display:flex; align-items:center; gap:9px; padding-top:23px; }} .check input {{ width:auto; }} .check label {{ margin:0; color:var(--ink); }}
    .section-note {{ background:#faf9ff; border-right:4px solid var(--brand2); padding:10px 12px; border-radius:8px; color:var(--muted); font-size:13px; line-height:1.55; }}
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
    .login {{ position:fixed; inset:0; display:grid; place-items:center; padding:20px; background:rgba(24,24,45,.36); backdrop-filter:blur(7px); z-index:20; }}
    .login-box {{ width:min(420px,100%); background:white; padding:28px; border-radius:24px; box-shadow:0 30px 90px rgba(25,22,55,.25); }}
    .login-box h2 {{ font-size:25px; }} .error {{ min-height:20px; color:var(--bad); font-size:14px; }} [hidden] {{ display:none!important; }}
    @media(max-width:850px) {{ .stats {{ grid-template-columns:repeat(2,1fr) }} .grid,.form-grid {{ grid-template-columns:1fr }}
      .span2,.span3 {{ grid-column:auto }} header {{ align-items:start; flex-direction:column; }} }}
  </style>
</head>
<body>
  <main class="wrap">
    <header><div><h1>התקדמות ושליטה במורה</h1><p class="sub">שיעורים, ניקוד, עלות והגדרות Gemini לשיחה הבאה</p></div>
      <div class="actions"><button id="refresh" class="secondary">רענון</button><button id="logout" class="secondary">יציאה</button></div></header>
    <section class="stats">
      <div class="card"><div class="label">סה״כ נקודות</div><div class="value" id="points">—</div></div>
      <div class="card"><div class="label">סה״כ שיחות</div><div class="value" id="sessions">—</div></div>
      <div class="card"><div class="label">דקות תרגול</div><div class="value" id="minutes">—</div></div>
      <div class="card"><div class="label">עלות Gemini משוערת</div><div class="value" id="cost">—</div></div>
    </section>
    <section class="grid">
      <aside class="card"><h2>מיומנויות</h2><div id="skills" class="empty">עדיין אין ציונים</div>
        <p class="note">הציונים הם הערכת המורה במהלך התרגול ואינם ציון בית־ספרי.</p></aside>
      <section class="card"><h2>סיכומי שיחות</h2><div id="history" class="empty">עדיין אין שיחות שמורות</div>
        <p class="note">העלות היא אומדן לפי נתוני Gemini; החיוב בחשבון Google הוא הקובע.</p></section>
    </section>

    <form class="card" id="controlForm">
      <h2>שליטה בשיעור הבא</h2>
      <p class="section-note">השינויים נשמרים מיידית במסד הנתונים וחלים על שיחה חדשה. הם אינם משנים שיחה שכבר מחוברת.</p>
      <h3>מטרות והתנהגות</h3>
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

      <h3>קול וזיהוי דיבור</h3>
      <div class="form-grid">
        <div><label for="voice">קול</label><select id="voice"></select></div>
        <div><label for="language_code">קוד שפה שנשלח</label><input id="language_code" maxlength="20"></div>
        <div><label for="input_batch_frames">צבירת קלט: מסגרות × 20ms</label><input id="input_batch_frames" type="number" min="1" max="20"></div>
        <div><label for="vad_start_sensitivity">רגישות התחלת דיבור</label><select id="vad_start_sensitivity"></select></div>
        <div><label for="vad_end_sensitivity">רגישות סיום דיבור</label><select id="vad_end_sensitivity"></select></div>
        <div><label for="vad_prefix_ms">Prefix / אישור התחלה במ״ש</label><input id="vad_prefix_ms" type="number" min="0" max="1000"></div>
        <div><label for="vad_silence_ms">שקט לסיום משפט במ״ש</label><input id="vad_silence_ms" type="number" min="100" max="2000"></div>
        <div><label for="activity_handling">מה קורה כשהתלמידה מדברת</label><select id="activity_handling"></select></div>
        <div><label for="turn_coverage">איזה אודיו נכלל בתור</label><select id="turn_coverage"></select></div>
      </div>

      <h3>תמלול והקשר</h3>
      <div class="form-grid">
        <div><label for="transcription_mode">מצב תמלול</label><select id="transcription_mode"></select></div>
        <div><label for="transcription_language_codes">רמזי שפה, מופרדים בפסיק</label><input id="transcription_language_codes" placeholder="he-IL,en-US"></div>
        <div class="check"><input id="store_transcripts" type="checkbox"><label for="store_transcripts">לשמור תמלילים מלאים (רגיש לפרטיות)</label></div>
        <div class="span2"><label for="custom_vocabulary">אוצר מילים מותאם, מונח אחד בכל שורה</label><textarea id="custom_vocabulary"></textarea></div>
        <div><label for="context_trigger_tokens">סף דחיסת הקשר</label><input id="context_trigger_tokens" type="number" min="1000" max="120000"></div>
        <div><label for="context_target_tokens">יעד לאחר דחיסה</label><input id="context_target_tokens" type="number" min="500" max="100000"></div>
      </div>
      <div class="save-row"><div id="saveStatus" class="status"></div><div class="actions"><button type="button" id="reset" class="danger">איפוס לברירות המחדל</button><button type="submit" id="save">שמירת הגדרות</button></div></div>
    </form>

    <section class="card">
      <h2>מה נשלח בפועל ל־AI</h2>
      <p class="section-note">התצוגה מתעדכנת לאחר שמירה וכוללת את הפרומפט הבסיסי, מטרת השיעור, מדיניות הסיום, סך הנקודות מכל השיחות, צעדי ההמשך והיסטוריית הלמידה המצומצמת.</p>
      <h3>System instruction האפקטיבי</h3><pre id="effectivePrompt">טוען…</pre>
      <details><summary>הודעת הפתיחה המדויקת</summary><pre id="openingPayload"></pre></details>
      <details><summary>כל הודעת ה־setup המדויקת ל־Gemini</summary><pre id="setupPayload"></pre></details>
      <details><summary>פרטים קבועים שאינם ניתנים לשינוי דינמי</summary><pre id="runtimePayload"></pre></details>
    </section>
  </main>
  <section class="login" id="login"><form class="login-box" id="loginForm"><h2>כניסה ללוח ההורה</h2>
    <p class="sub">הזינו את סיסמת המנהל המוגדרת ב־Render.</p><input id="token" type="password" autocomplete="current-password" placeholder="סיסמת מנהל" required>
    <div class="error" id="error"></div><button type="submit">כניסה</button></form></section>
  <script>
    const progressEndpoint={progress_endpoint}, configEndpoint="/v1/admin/config"; const $=id=>document.getElementById(id);
    const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}}[c]));
    const money=n=>n>0&&n<0.0001?"פחות מ־$0.0001":"$"+Number(n||0).toFixed(4);
    const auth=()=>({{Authorization:"Bearer "+sessionStorage.getItem("adminToken")}});
    function fillSelect(id,values,current){{$(id).innerHTML=values.map(v=>`<option value="${{esc(v)}}">${{esc(v)}}</option>`).join("");$(id).value=current;}}
    function renderProgress(data){{$("points").textContent=data.total_points??0;$("sessions").textContent=data.session_count??0;
      $("minutes").textContent=data.total_minutes??0;$("cost").textContent=money(data.estimated_cost_usd);const skills=Object.entries(data.skill_averages||{{}});
      const names={{fluency:"שטף דיבור",grammar:"דקדוק",vocabulary:"אוצר מילים",pronunciation:"הגייה",comprehension:"הבנה"}};
      $("skills").className=skills.length?"":"empty";$("skills").innerHTML=skills.length?skills.map(([n,s])=>`<div class="skill"><div class="skill-head"><span>${{esc(names[n]||n)}}</span><strong>${{Number(s).toFixed(1)}}/5</strong></div><div class="bar"><span style="width:${{Math.min(100,Number(s)*20)}}%"></span></div></div>`).join(""):"עדיין אין ציונים";
      const rows=data.sessions||[];$("history").className=rows.length?"":"empty";$("history").innerHTML=rows.length?rows.map(r=>`<article class="session"><div class="session-title"><strong>${{esc(new Date(r.started_at).toLocaleString("he-IL"))}}</strong><span class="points">+${{Number(r.points||0)}} נקודות</span></div><p class="summary">${{esc(r.summary_he||"השיחה נשמרה ללא סיכום מילולי.")}}</p>${{r.success_he?`<p><b>מה הצליח:</b> ${{esc(r.success_he)}}</p>`:""}}${{r.next_step_he?`<p><b>הצעד הבא:</b> ${{esc(r.next_step_he)}}</p>`:""}}<div class="meta"><span class="pill">${{Math.round((r.duration_seconds||0)/60)}} דקות</span><span class="pill">${{r.learner_turns||0}} תשובות</span><span class="pill">עלות ${{money(r.estimated_cost_usd)}}</span></div></article>`).join(""):"עדיין אין שיחות שמורות";}}
    function renderConfig(data){{const c=data.controls,o=data.options;["learning_goal","custom_instructions","opening_message","base_prompt","language_code"].forEach(k=>$(k).value=c[k]??"");
      ["target_lesson_minutes","max_call_minutes","input_batch_frames","vad_prefix_ms","vad_silence_ms","context_trigger_tokens","context_target_tokens"].forEach(k=>$(k).value=c[k]);
      $("temperature").value=c.temperature??"";$("ending_policy").value=c.ending_policy;$("store_transcripts").checked=!!c.store_transcripts;
      $("transcription_language_codes").value=(c.transcription_language_codes||[]).join(",");$("custom_vocabulary").value=(c.custom_vocabulary||[]).join("\\n");
      fillSelect("voice",o.voices,c.voice);fillSelect("vad_start_sensitivity",o.vad_start_sensitivity,c.vad_start_sensitivity);fillSelect("vad_end_sensitivity",o.vad_end_sensitivity,c.vad_end_sensitivity);fillSelect("activity_handling",o.activity_handling,c.activity_handling);fillSelect("turn_coverage",o.turn_coverage,c.turn_coverage);fillSelect("transcription_mode",o.transcription_mode,c.transcription_mode);
      const setup=data.effective.setup_message;$("effectivePrompt").textContent=setup.setup.systemInstruction.parts[0].text;$("setupPayload").textContent=JSON.stringify(setup,null,2);$("openingPayload").textContent=JSON.stringify(data.effective.opening_client_message,null,2);$("runtimePayload").textContent=JSON.stringify(data.effective.read_only_runtime,null,2);}}
    function controlsFromForm(){{const integer=id=>Number.parseInt($(id).value,10),list=(id,separator)=>$(id).value.split(separator).map(x=>x.trim()).filter(Boolean);
      return {{base_prompt:$("base_prompt").value,opening_message:$("opening_message").value,learning_goal:$("learning_goal").value,custom_instructions:$("custom_instructions").value,target_lesson_minutes:integer("target_lesson_minutes"),ending_policy:$("ending_policy").value,voice:$("voice").value,language_code:$("language_code").value,temperature:$("temperature").value===""?null:Number($("temperature").value),vad_start_sensitivity:$("vad_start_sensitivity").value,vad_end_sensitivity:$("vad_end_sensitivity").value,vad_prefix_ms:integer("vad_prefix_ms"),vad_silence_ms:integer("vad_silence_ms"),activity_handling:$("activity_handling").value,turn_coverage:$("turn_coverage").value,input_batch_frames:integer("input_batch_frames"),transcription_mode:$("transcription_mode").value,transcription_language_codes:list("transcription_language_codes",","),custom_vocabulary:list("custom_vocabulary",/\\r?\\n/),store_transcripts:$("store_transcripts").checked,context_trigger_tokens:integer("context_trigger_tokens"),context_target_tokens:integer("context_target_tokens"),max_call_minutes:integer("max_call_minutes")}};}}
    async function request(url,options={{}}){{const response=await fetch(url,{{...options,headers:{{...auth(),...(options.headers||{{}})}},cache:"no-store"}});if(!response.ok){{let msg=response.status===401?"הסיסמה אינה נכונה":"הפעולה נכשלה";try{{const body=await response.json();msg=body.detail?JSON.stringify(body.detail):msg}}catch{{}}throw new Error(msg)}}return response.json();}}
    async function loadAll(token){{sessionStorage.setItem("adminToken",token);const [progress,config]=await Promise.all([request(progressEndpoint),request(configEndpoint)]);renderProgress(progress);renderConfig(config);$("login").hidden=true;}}
    $("loginForm").addEventListener("submit",async e=>{{e.preventDefault();$("error").textContent="";try{{await loadAll($("token").value)}}catch(err){{$("error").textContent=err.message}}}});
    $("controlForm").addEventListener("submit",async e=>{{e.preventDefault();$("save").disabled=true;$("saveStatus").className="status";$("saveStatus").textContent="שומר…";try{{const data=await request(configEndpoint,{{method:"PUT",headers:{{"Content-Type":"application/json"}},body:JSON.stringify(controlsFromForm())}});renderConfig(data);$("saveStatus").textContent="נשמר. ההגדרות יחולו בשיחה הבאה."}}catch(err){{$("saveStatus").className="status error";$("saveStatus").textContent=err.message}}finally{{$("save").disabled=false}}}});
    $("reset").addEventListener("click",async()=>{{if(!confirm("לאפס את כל הגדרות המורה לברירות המחדל?"))return;try{{renderConfig(await request(configEndpoint,{{method:"DELETE"}}));$("saveStatus").textContent="ההגדרות אופסו."}}catch(err){{$("saveStatus").className="status error";$("saveStatus").textContent=err.message}}}});
    $("refresh").addEventListener("click",()=>loadAll(sessionStorage.getItem("adminToken")).catch(()=>$("login").hidden=false));
    $("logout").addEventListener("click",()=>{{sessionStorage.removeItem("adminToken");$("token").value="";$("login").hidden=false}});
    const saved=sessionStorage.getItem("adminToken");if(saved)loadAll(saved).catch(()=>{{sessionStorage.removeItem("adminToken");$("login").hidden=false}});
  </script>
</body></html>"""
