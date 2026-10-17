# The dashboard is a self-contained HTML/JavaScript artifact; keeping its source lines
# intact makes the browser markup substantially easier to maintain.
# ruff: noqa: E501

from __future__ import annotations

import json


def dashboard_html(student_id: str) -> str:
    endpoint = json.dumps(f"/v1/progress/{student_id}")
    return f"""<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>לוח ההתקדמות באנגלית</title>
  <style>
    :root {{ color-scheme: light; --ink:#172033; --muted:#667085; --card:#fff;
      --brand:#6d5ce7; --brand2:#9d7bea; --good:#18865b; --line:#e8e7f2; }}
    * {{ box-sizing:border-box }}
    body {{ margin:0; font-family:Arial,"Noto Sans Hebrew",sans-serif; color:var(--ink);
      background:linear-gradient(145deg,#f7f5ff,#f4fbff 55%,#fff8ef); min-height:100vh; }}
    .wrap {{ width:min(1120px,calc(100% - 28px)); margin:0 auto; padding:32px 0 56px; }}
    header {{ display:flex; justify-content:space-between; gap:18px; align-items:end; margin-bottom:24px; }}
    h1 {{ margin:0; font-size:clamp(28px,5vw,44px); letter-spacing:-1px; }}
    .sub {{ margin:7px 0 0; color:var(--muted); }}
    button {{ border:0; border-radius:12px; padding:11px 17px; font-weight:700; cursor:pointer;
      background:var(--brand); color:white; }}
    button.secondary {{ background:#eeeafd; color:#4e3fc2; }}
    .stats {{ display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:18px; }}
    .card {{ background:rgba(255,255,255,.9); border:1px solid var(--line); border-radius:20px;
      box-shadow:0 10px 35px rgba(67,55,125,.08); padding:20px; }}
    .label {{ color:var(--muted); font-size:14px; }}
    .value {{ font-size:29px; font-weight:800; margin-top:8px; }}
    .grid {{ display:grid; grid-template-columns:1fr 2fr; gap:18px; align-items:start; }}
    h2 {{ margin:0 0 15px; font-size:21px; }}
    .skill {{ margin:13px 0; }} .skill-head {{ display:flex; justify-content:space-between; }}
    .bar {{ height:9px; border-radius:20px; background:#eeeefa; overflow:hidden; margin-top:7px; }}
    .bar span {{ display:block; height:100%; background:linear-gradient(90deg,var(--brand),var(--brand2)); }}
    .session {{ border-top:1px solid var(--line); padding:18px 0; }}
    .session:first-of-type {{ border-top:0; padding-top:0; }}
    .session-title {{ display:flex; justify-content:space-between; gap:14px; align-items:center; }}
    .points {{ color:var(--good); font-weight:800; white-space:nowrap; }}
    .summary {{ margin:11px 0; line-height:1.55; }}
    .meta {{ display:flex; flex-wrap:wrap; gap:8px; color:var(--muted); font-size:13px; }}
    .pill {{ background:#f5f3ff; border-radius:999px; padding:5px 9px; }}
    .note {{ margin-top:14px; color:var(--muted); font-size:12px; line-height:1.5; }}
    .empty {{ color:var(--muted); text-align:center; padding:28px 0; }}
    .login {{ position:fixed; inset:0; display:grid; place-items:center; padding:20px;
      background:rgba(24,24,45,.36); backdrop-filter:blur(7px); }}
    .login-box {{ width:min(420px,100%); background:white; padding:28px; border-radius:24px;
      box-shadow:0 30px 90px rgba(25,22,55,.25); }}
    .login-box h2 {{ font-size:25px; }}
    input {{ width:100%; border:1px solid #d8d5e8; border-radius:12px; padding:13px; font-size:16px;
      margin:8px 0 12px; }}
    .error {{ min-height:20px; color:#b42318; font-size:14px; }}
    [hidden] {{ display:none!important; }}
    @media (max-width:800px) {{ .stats {{ grid-template-columns:repeat(2,1fr) }}
      .grid {{ grid-template-columns:1fr }} header {{ align-items:start; flex-direction:column; }} }}
  </style>
</head>
<body>
  <main class="wrap">
    <header><div><h1>התקדמות באנגלית</h1><p class="sub">שיעורים, הצלחות, נקודות ועלות Gemini</p></div>
      <button id="refresh" class="secondary">רענון נתונים</button></header>
    <section class="stats">
      <div class="card"><div class="label">סה״כ נקודות</div><div class="value" id="points">—</div></div>
      <div class="card"><div class="label">שיחות</div><div class="value" id="sessions">—</div></div>
      <div class="card"><div class="label">דקות תרגול</div><div class="value" id="minutes">—</div></div>
      <div class="card"><div class="label">עלות Gemini משוערת</div><div class="value" id="cost">—</div></div>
    </section>
    <section class="grid">
      <aside class="card"><h2>מיומנויות</h2><div id="skills" class="empty">עדיין אין ציונים</div>
        <p class="note">הציונים הם הערכת המורה במהלך התרגול ואינם ציון בית־ספרי.</p></aside>
      <section class="card"><h2>סיכומי שיחות</h2><div id="history" class="empty">עדיין אין שיחות שמורות</div>
        <p class="note">העלות היא אומדן לפי נתוני השימוש ש־Gemini מחזירה והתעריפים שהוגדרו במערכת;
        החיוב הקובע מופיע בחשבון Google.</p></section>
    </section>
  </main>
  <section class="login" id="login"><form class="login-box" id="loginForm">
    <h2>כניסה ללוח ההורה</h2><p class="sub">הזינו את סיסמת המנהל המוגדרת ב־Render.</p>
    <input id="token" type="password" autocomplete="current-password" placeholder="סיסמת מנהל" required>
    <div class="error" id="error"></div><button type="submit">הצגת ההתקדמות</button>
  </form></section>
  <script>
    const endpoint={endpoint};
    const skillNames={{fluency:"שטף דיבור",grammar:"דקדוק",vocabulary:"אוצר מילים",
      pronunciation:"הגייה",comprehension:"הבנה"}};
    const $=id=>document.getElementById(id);
    const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({{"&":"&amp;","<":"&lt;",
      ">":"&gt;",'"':"&quot;","'":"&#039;"}}[c]));
    const money=n=>n>0&&n<0.0001?"פחות מ־$0.0001":"$"+Number(n||0).toFixed(4);
    function render(data){{
      $("points").textContent=data.total_points??0; $("sessions").textContent=data.session_count??0;
      $("minutes").textContent=data.total_minutes??0; $("cost").textContent=money(data.estimated_cost_usd);
      const skills=Object.entries(data.skill_averages||{{}});
      $("skills").className=skills.length?"":"empty";
      $("skills").innerHTML=skills.length?skills.map(([name,score])=>`<div class="skill"><div class="skill-head">
        <span>${{esc(skillNames[name]||name)}}</span><strong>${{Number(score).toFixed(1)}}/5</strong></div>
        <div class="bar"><span style="width:${{Math.min(100,Number(score)*20)}}%"></span></div></div>`).join(""):
        "עדיין אין ציונים";
      const rows=data.sessions||[]; $("history").className=rows.length?"":"empty";
      $("history").innerHTML=rows.length?rows.map(row=>`<article class="session"><div class="session-title">
        <strong>${{esc(new Date(row.started_at).toLocaleString("he-IL"))}}</strong>
        <span class="points">+${{Number(row.points||0)}} נקודות</span></div>
        <p class="summary">${{esc(row.summary_he||"השיחה נשמרה ללא סיכום מילולי.")}}</p>
        ${{row.success_he?`<p><b>מה הצליח:</b> ${{esc(row.success_he)}}</p>`:""}}
        ${{row.next_step_he?`<p><b>הצעד הבא:</b> ${{esc(row.next_step_he)}}</p>`:""}}
        <div class="meta"><span class="pill">${{Math.round((row.duration_seconds||0)/60)}} דקות</span>
        <span class="pill">${{row.learner_turns||0}} תשובות</span><span class="pill">עלות ${{money(row.estimated_cost_usd)}}</span>
        <span class="pill">${{esc(row.model||"Gemini")}}</span></div></article>`).join(""):"עדיין אין שיחות שמורות";
    }}
    async function load(token){{
      const response=await fetch(endpoint,{{headers:{{Authorization:"Bearer "+token}},cache:"no-store"}});
      if(!response.ok) throw new Error(response.status===401?"הסיסמה אינה נכונה":"לא ניתן לטעון נתונים");
      render(await response.json()); sessionStorage.setItem("adminToken",token); $("login").hidden=true;
    }}
    $("loginForm").addEventListener("submit",async e=>{{e.preventDefault(); $("error").textContent="";
      try{{await load($("token").value)}}catch(err){{$("error").textContent=err.message}}}});
    $("refresh").addEventListener("click",()=>{{const token=sessionStorage.getItem("adminToken");
      if(token)load(token).catch(()=>$("login").hidden=false);}});
    const saved=sessionStorage.getItem("adminToken"); if(saved)load(saved).catch(()=>sessionStorage.removeItem("adminToken"));
  </script>
</body></html>"""
