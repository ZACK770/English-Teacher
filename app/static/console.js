"use strict";
const $=id=>document.getElementById(id), esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=v=>v==null?"טרם נמדד":new Intl.NumberFormat("he-IL",{style:"currency",currency:"ILS",maximumFractionDigits:2}).format(v);
const date=v=>v?new Date(v).toLocaleString("he-IL"):"—";
const state={token:sessionStorage.getItem("adminToken")||"",bots:[],page:"overview",bot:null,tab:"identity",data:null,epoch:0,drafts:{}};
const pages=[["overview","◈","תמונת מצב"],["bots","◉","בוטים ומורים"],["customers","♙","לקוחות"],["courses","▤","מסלולי לימוד"],["packages","▣","חבילות ותשלומים"],["narrations","≋","קריינות ותפריטים"],["logs","◷","שיחות וביצועים"],["economics","↗","רווחיות וצמיחה"],["connections","⇄","ערוצים וחיבורים"]];
const roleNames={teacher:"מורה",translator:"תרגומון",sales:"מכירות",service:"שירות",custom:"מותאם"};
const productNames={school:"בית הספר",translator:"תרגומון"};
function toast(s){$("toast").textContent=s;$("toast").hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$("toast").hidden=true,5000)}
async function api(path,method="GET",body){
 const r=await fetch(path,{method,headers:{"Authorization":"Bearer "+state.token,"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:"no-store"});
 if(r.status===401){sessionStorage.removeItem("adminToken");$("app").hidden=true;$("login").hidden=false;throw Error("הסיסמה אינה נכונה או שפג תוקף הכניסה.");}
 if(!r.ok){let b;try{b=await r.json()}catch{}throw Error(typeof b?.detail==="string"?b.detail:"לא ניתן לשמור. בדוק את השדות ונסה שוב.");}
 return r.json();
}
const business=(path,method,body)=>api("/v1/admin/business/"+path,method,body);
pages.splice(pages.length-1,0,["pbx","☎","מרכזייה חיה"]);
function head(title,description,action=""){return `<div class="page-head"><div><span class="eyebrow">מרכז הניהול / ${esc(pages.find(p=>p[0]===state.page)?.[2]||"בוטים")}</span><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${action}</div>`}
function empty(title,text){return `<div class="empty"><div class="empty-icon">◇</div><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`}
function metric(label,value,note,dark=false){return `<article class="metric ${dark?"dark":""}"><p>${esc(label)}</p><div class="value">${esc(value)}</div><small>${esc(note)}</small></article>`}
function table(headers,rows){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`}
function row(cells){return `<tr>${cells.map(c=>`<td>${c}</td>`).join("")}</tr>`}
function badge(text,type=""){return `<span class="badge ${type}">${esc(text)}</span>`}
function field(key,label,value="",type="text",help="",full=false,options=null){
 const id="f_"+key;
 let input=options?`<select id="${id}" data-key="${key}">${options.map(o=>{const [v,n]=Array.isArray(o)?o:[o,o];return `<option value="${esc(v)}" ${String(value)===String(v)?"selected":""}>${esc(n)}</option>`}).join("")}</select>`:
 type==="textarea"?`<textarea id="${id}" data-key="${key}" class="${key==="base_prompt"?"prompt":""}">${esc(value)}</textarea>`:
 type==="checkbox"?`<input type="checkbox" id="${id}" data-key="${key}" ${value?"checked":""}>`:
 `<input id="${id}" data-key="${key}" type="${type}" ${type==="number"?'step="any"':""} value="${esc(value)}">`;
 return `<div class="field ${full?"full":""}"><label for="${id}">${esc(label)}</label>${input}${help?`<small>${esc(help)}</small>`:""}</div>`;
}
function readFields(root){const data={};root.querySelectorAll("[data-key]").forEach(e=>{data[e.dataset.key]=e.type==="checkbox"?e.checked:e.type==="number"?(e.value===""?null:Number(e.value)):e.value});return data}
function dialog(title,fields,save){
 $("editorTitle").textContent=title;$("editorFields").innerHTML=fields;$("editorError").textContent="";
 $("editorForm").onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await save(readFields($("editorFields")));$("editor").close();toast("נשמר בהצלחה");await render()}catch(err){$("editorError").textContent=err.message}finally{b.disabled=false}};
 $("editor").showModal();
}
$("closeEditor").onclick=()=>$("editor").close();
async function start(){
 state.bots=(await api("/v1/admin/profiles")).profiles;
 sessionStorage.setItem("adminToken",state.token);$("login").hidden=true;$("app").hidden=false;await render();
}
$("loginForm").onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;$("loginError").textContent="";state.token=$("token").value;try{await start()}catch(err){$("loginError").textContent=err.message}finally{e.submitter.disabled=false}};
$("logout").onclick=()=>{state.token="";sessionStorage.removeItem("adminToken");$("app").hidden=true;$("login").hidden=false;$("token").value=""};
$("refresh").onclick=()=>render();
window.addEventListener("hashchange",()=>{if(state.token)render()});
async function render(){
 const epoch=++state.epoch, parts=location.hash.slice(1).split("/");
 state.page=pages.some(p=>p[0]===parts[0])?parts[0]:"overview";
 state.bot=parts[1]||null;
 $("navigation").innerHTML=pages.map(([id,icon,label])=>`<a class="nav-item ${id===state.page?"active":""}" href="#${id}"><span>${icon}</span>${label}</a>`).join("");
 $("breadcrumb").textContent="מרכז הניהול  /  "+pages.find(p=>p[0]===state.page)[2];
 $("content").innerHTML=`<div class="empty">טוען נתונים…</div>`;
 try{
  const html=await views[state.page]();
  if(epoch!==state.epoch)return;
  $("content").innerHTML=html;
  bind();
 }catch(err){if(epoch===state.epoch)$("content").innerHTML=empty("לא ניתן לטעון כרגע",err.message)}
}
const views={
 async overview(){
  const s=await business("overview");
  return head("העסק, במבט אחד","תמונת מצב לחודש "+s.period+" · נתונים שנרשמו במערכת")
   +`<section class="metrics">${metric("תקבולים החודש",money(s.gross_receipts_ils),"כולל מע״מ · רישום תשלומים",true)}${metric("לקוחות משלמים",s.paying_customers_month,"עם תשלום רשום החודש")}${metric("עלות AI",money(s.ai_cost_ils),"אומדן שימוש · לא חשבונית ספק")}${metric("עודף לפי הוצאות ידועות",money(s.known_cash_surplus_ils),"לפני הוצאות שלא הוזנו")}</section>`
   +`<div class="grid2"><section class="panel"><div class="panel-head"><h2>מה תרצה לעשות היום?</h2>${badge("ניהול שוטף")}</div>
   ${[["bots","ניהול המורים והבוטים","פרומפטים, קול, שפה וגרסאות"],["customers","הלקוחות שלך","חשבון נפרד לכל אדם"],["courses","התקדמות בלמידה","מסלולים, שיעורים ורישום"],["logs","איכות השיחות","תמלילים, פרומפטים וזמני תגובה"]].map(([id,a,b])=>`<a class="progress-step" href="#${id}"><div><h3>${a}</h3><p>${b}</p></div><span>←</span></a>`).join("")}</section>
   <section class="panel"><div class="panel-head"><h2>המספרים שמאחורי הצמיחה</h2></div>
   <div class="progress-step"><span>לקוחות רשומים</span><b>${s.customers}</b></div>
   <div class="progress-step"><span>תרגומון חינם · הוצאות פרסום</span><b>${money(s.free_translator_ad_cost_ils)}</b></div>
   <div class="progress-step"><span>CAC נמדד חלקית</span><b>${money(s.cac_ils)}</b></div>
   <div class="progress-step"><span>LTV בפועל</span>${badge("אין עדיין מדידת שימור","neutral")}</div>
   <a class="progress-step" href="#economics"><b>למודל הרווחיות ולתרחישים</b><span>←</span></a></section></div>`
   +`<div class="notice">${esc(s.notes[1])}${s.unattributed_sessions?` ${s.unattributed_sessions} שיחות ישנות אינן משויכות ללקוח.`:""}</div>`;
 },
 async bots(){
  state.bots=(await api("/v1/admin/profiles")).profiles;
  if(state.bot)return botView();
  return head("בוטים ומורים","לכל בוט זהות, הנחיות, הגדרות דיבור וכתובת חיבור משלו.",'<button class="primary" data-action="newBot">＋ יצירת בוט</button>')
  +`<div class="cards">${state.bots.map(b=>`<article class="bot-card"><div class="card-top"><div class="bot-icon">◉</div>${badge(b.enabled?"פעיל":"מושהה",b.enabled?"":"neutral")}</div><div><h2>${esc(b.label)}</h2><small>${esc(roleNames[b.role]||b.role)} · גרסה ${b.active_version}</small></div><p>${esc(b.description||"הגדר את סגנון השיחה והמטרות של הבוט.")}</p><small>${b.channel_configured?"● ערוץ טלפוני מוגדר":"○ טרם הוגדר ערוץ טלפוני"}</small><a class="ghost" href="#bots/${encodeURIComponent(b.id)}">פתיחת הבוט ←</a></article>`).join("")}</div>`;
 },
 async customers(){
  const items=(await business("customers")).items;state.items=items;
  return head("לקוחות","חשבון נפרד לכל אדם, ללא תלות במורה שנבחר.",'<button class="primary" data-action="newCustomer">＋ הוספת לקוח</button>')
  +`<section class="panel"><div class="toolbar"><input id="search" placeholder="חיפוש לפי שם או טלפון" aria-label="חיפוש לקוחות"></div>${items.length?table(["לקוח","טלפון","מקור הגעה","מורה מועדף","עודכן",""],items.map(c=>row([esc(c.name),`<span dir="ltr">${esc(c.phone)}</span>`,esc(c.source),esc(state.bots.find(b=>b.id===c.preferred_bot)?.label||"לא נבחר"),date(c.updated_at),`<button class="ghost" data-edit="customers" data-id="${esc(c.id)}">פתיחה</button>`]))):empty("הלקוח הראשון מתחיל כאן","מתקשרים מזוהים יתווספו אוטומטית; אפשר להוסיף גם ידנית.")}</section>`;
 },
 async courses(){
  const [courses,enrollments,customers]=await Promise.all([business("courses"),business("enrollments"),business("customers")]);state.items=courses.items;state.enrollmentItems=enrollments.items;state.courseLists={courses:courses.items,customers:customers.items};
  return head("מסלולי לימוד","שיעורים מסודרים והנחיות שמצטרפות לפרומפט של המורה בשיחה.",'<button class="primary" data-action="newCourse">＋ מסלול חדש</button>')
  +`<div class="cards">${courses.items.map(c=>`<article class="bot-card"><div class="card-top"><div class="bot-icon">▤</div>${badge(c.active?"פעיל":"טיוטה",c.active?"":"neutral")}</div><h2>${esc(c.name)}</h2><p>${esc(c.level)} · ${c.lessons.length} שיעורים</p><small>${esc(state.bots.find(b=>b.id===c.bot_id)?.label||"ללא מורה")}</small><button class="ghost" data-edit="courses" data-id="${esc(c.id)}">עריכת המסלול</button></article>`).join("")||empty("בונים את מסלול הלמידה הראשון","לכל שיעור מטרה, הוראות ותנאי הצלחה.")}</div>`
  +`<section class="panel" style="margin-top:24px"><div class="panel-head"><h2>רישום והתקדמות</h2><button class="ghost" data-action="newEnrollment">שיוך תלמיד למסלול</button></div>${enrollments.items.length?table(["תלמיד","מסלול","שיעור נוכחי","מצב",""],enrollments.items.map(e=>row([esc(customers.items.find(c=>c.id===e.customer_id)?.name||e.customer_id),esc(courses.items.find(c=>c.id===e.course_id)?.name||e.course_id),String(e.lesson_index+1),esc(({active:"בלמידה",completed:"הושלם",paused:"בהשהיה"})[e.status]),`<button class="ghost" data-enroll="${esc(e.id)}">עדכון התקדמות</button>`]))):empty("אין עדיין תלמידים רשומים למסלול","הוראות השיעור נטענות בשיחה הבאה של התלמיד.")}<p class="notice">קידום השיעור מנוהל ידנית. ניקוד המורה אינו מקדם תלמיד אוטומטית.</p></section>`;
 },
 async packages(){
  const [packages,overview,customers]=await Promise.all([business("packages"),business("overview"),business("customers")]);state.items=packages.items;state.receiptLists={packages:packages.items,customers:customers.items};
  return head("חבילות ותשלומים","מחירים כוללים מע״מ. תשלום שנרשם יוצר זכאות עם דקות ותאריך תפוגה.",'<button class="primary" data-action="newPackage">＋ חבילה חדשה</button>')
  +`<div class="cards">${packages.items.map(p=>`<article class="bot-card"><div class="card-top">${badge(productNames[p.product])}${badge(p.active?"פעילה":"טיוטה",p.active?"":"neutral")}</div><h2>${esc(p.name)}</h2><h1>${money(p.price_ils)}</h1><p>${p.minutes} דקות · ${p.validity_days} ימים</p><button class="ghost" data-edit="packages" data-id="${esc(p.id)}">עריכת החבילה</button></article>`).join("")||empty("עדיין אין חבילות","הגדר את שתי משפחות המוצרים ואת המחירים שלך.")}</div>`
  +`<section class="panel" style="margin-top:24px"><div class="panel-head"><h2>רישום תשלומים</h2><button class="ghost" data-action="newReceipt">רישום תשלום שהתקבל</button></div><div class="notice warn">זהו רישום ידני של תשלום שהתקבל מחוץ למערכת. הוא יוצר יתרה ותוקף. אכיפה מופעלת בכל בוט בלשונית דקות ומכסות; רישום כאן אינו מחייב כרטיס אשראי.</div>${overview.receipts.length?table(["אסמכתה","לקוח","מוצר","סכום כולל מע״מ","תוקף"],overview.receipts.map(r=>row([esc(r.reference),esc(customers.items.find(c=>c.id===r.customer_id)?.name||r.customer_id),productNames[r.product],money(r.amount_ils),date(r.expires_at)]))):empty("אין עדיין תשלומים רשומים","רישום תשלום יופיע גם בתמונת המצב העסקית.")}</section>`;
 },
 async narrations(){
  const items=(await business("narrations")).items;state.items=items;
  return head("קריינות ותפריטים","מקום אחד לנוסחי הפתיחה, בחירת השפה, המכירה והשירות.",'<button class="primary" data-action="newNarration">＋ נוסח חדש</button>')
  +`<div class="notice">אפשר לייצר קריינות בקול של הבוט, להאזין ולהוריד WAV לטלפון. אישור נוסח אינו מעלה הקלטה לטכנוליין. הודעת הפתיחה של בוט מנוהלת בעורך הבוט ונשלחת ל־Gemini.</div><section class="panel">${items.length?table(["שם","מיקום","שפה","שלוחה","מצב",""],items.map(n=>row([esc(n.name),esc(n.placement),esc(n.language),esc(n.technoline_extension||"לא משויכת"),badge(n.status==="approved"?"נוסח מאושר":"טיוטה","neutral"),`<button class="ghost" data-edit="narrations" data-id="${esc(n.id)}">עריכת הנוסח</button> <button class="ghost" data-audio="${esc(n.id)}">יצירת קריינות</button>`]))):empty("ספריית הקריינות שלך","צור נוסח לכל נקודה בחוויית המתקשר.")}</section>`;
 },
 async logs(){
  state.bots=(await api("/v1/admin/profiles")).profiles;
  const bot=state.logBot||state.bots[0]?.id;
  state.logBot=bot;
  const [traceData,performance,diagnostics]=bot?await Promise.all([api("/v1/admin/traces/"+encodeURIComponent(bot)+"?limit=50"),business("performance/"+encodeURIComponent(bot)),api("/v1/admin/diagnostics/"+encodeURIComponent(bot))]):[{traces:[]},null,{events:[]}];
  const traces=traceData.traces;
  return head("שיחות וביצועים","מה נכנס, מה יצא, אילו הנחיות נשלחו וכמה זמן עבר בכל שלב.")
  +`<div class="toolbar"><select id="logBot" aria-label="בחירת בוט ללוגים">${state.bots.map(b=>`<option value="${esc(b.id)}" ${b.id===bot?"selected":""}>${esc(b.label)}</option>`).join("")}</select><input id="search" placeholder="חיפוש בשיחות שנטענו" aria-label="חיפוש שיחות"></div>`
  +(performance?`<section class="metrics">${[["connection","חיבור Gemini"],["first_greeting","עד האודיו הראשון בפתיחה"],["server_delivery","מהמודל לשליחה לטלפון"]].map(([k,label])=>metric(label,performance[k].p50==null?"אין דגימות":performance[k].p50+" מ״ש",`P95: ${performance[k].p95??"—"} · ${performance[k].samples} דגימות · 30 ימים`)).join("")}${metric("אירועים ביומן",diagnostics.events.length,"אירועים אחרונים לבוט")}</section>`:"")
  +`<p class="notice">מוצגות עד 50 שיחות אחרונות לבוט. זמני השרת אינם מדידה של הרגע שבו המתקשר שמע את הקול בטלפון.</p>`
  +`<section class="panel"><details><summary>יומן תפעולי · שגיאות, קטיעות וחיבורים</summary>${diagnostics.events.length?table(["מועד","אירוע","שיחה","פרטים"],diagnostics.events.map(d=>row([esc(date(d.created_at)),esc(latencyLabels[d.event_type]||d.event_type),`<code>${esc(d.call_id)}</code>`,`<details><summary>פתיחה</summary><pre>${esc(JSON.stringify(d.details,null,2))}</pre></details>`]))):empty("אין אירועים","אירועים יופיעו כאן עם השימוש.")}</details></section>`
  +`<section class="panel">${traces.length?traces.map(t=>`<details class="trace"><summary>${esc(date(t.created_at))} · גרסה ${t.bot_version} <small dir="ltr">${esc(t.call_id)}</small></summary><div class="grid2"><div><h3>השיחה</h3>${t.turns.map(x=>`<div class="bubble ${esc(x.direction)}"><b>${x.direction==="input"?"הלקוח":"הבוט"}</b>${esc(x.text)}</div>`).join("")||empty("לא התקבל תמליל","ייתכן שהשיחה הסתיימה לפני שנוצר טקסט.")}</div><div><h3>ציר זמן</h3><div class="timeline">${t.latency.map(l=>`<div class="event"><b>${esc(latencyLabels[l.event_name]||l.event_name)}</b><small>${Math.round(l.since_call_start_ms)} מ״ש מתחילת השיחה · ${Math.round(l.since_previous_ms)}+ מהאירוע הקודם</small></div>`).join("")}</div></div></div><details><summary>הפרומפט המדויק שנשלח</summary><pre>${esc(t.system_instruction)}</pre></details><details><summary>Setup מלא</summary><pre>${esc(JSON.stringify(t.setup_message,null,2))}</pre></details></details>`).join(""):empty("השיחה הבאה תופיע כאן","הלוגים נאספים בשיחות אמת; אין נתוני הדגמה.")}</section>`;
 },
 async economics(){
  const [e,s]=await Promise.all([business("economics"),business("overview")]);state.economics=e;
  const labels={vat_rate:"שיעור מע״מ לצורך חישוב (0.18 = 18%)",usd_ils:"שער דולר לצורך אומדן",fixed_monthly_ils:"הוצאות קבועות לחודש בש״ח",paid_marketing_ils:"פרסום חודשי בתשלום",owner_hours_month:"שעות עבודה עצמית לחודש",owner_hour_value:"שווי שעת עבודה",development_cash:"פיתוח · הוצאה חיצונית",development_self_work:"פיתוח · שווי עבודה עצמית",forecast_price_ils:"מחיר חודשי ממוצע ללקוח · כולל מע״מ",forecast_minutes:"דקות שימוש צפויות ללקוח",forecast_cost_per_minute:"עלות משתנה צפויה לדקה בש״ח",forecast_payment_fee:"עמלת תשלום צפויה ללקוח",forecast_lifetime_months:"משך חיים צפוי בחודשים",free_budget_ils:"יעד תקציב חינמי חודשי · אינו חסם אוטומטי"};
  Object.assign(labels,{school_price_ils:"בית הספר · מחיר ממוצע כולל מע״מ",school_minutes:"בית הספר · דקות צפויות ללקוח",school_minute_cost:"בית הספר · עלות משתנה לדקה",translator_price_ils:"תרגומון · מחיר ממוצע כולל מע״מ",translator_minutes:"תרגומון · דקות צפויות ללקוח",translator_minute_cost:"תרגומון · עלות משתנה לדקה"});
  return head("רווחיות וצמיחה","נתוני שימוש ותשלומים לצד מודל הנחות שקוף — בלי להציג תחזית כעובדה.")
  +`<section class="metrics">${metric("CAC על בסיס נתונים רשומים",money(s.cac_ils),"פרסום + תרגומון חינם / משלמים חדשים")}${metric("תרומה צפויה ללקוח",money(s.forecast_contribution),"תחזית לפי ההנחות למטה",true)}${metric("נקודת איזון צפויה",s.forecast_break_even??"לא ניתנת לחישוב","לקוחות · ללא עלות עבודה עצמית")}${metric("LTV צפוי",money(s.forecast_ltv),"תחזית בלבד · LTV נמדד טרם קיים")}</section>`
  +`<section class="panel"><div class="panel-head"><h2>תרחישי היקף · מאוחד</h2>${badge("תחזית","warn")}</div>${table(["משלמים פעילים","תרומה חודשית","עודף אחרי הוצאות מוזנות"],s.scenarios.map(x=>row([x.customers,money(x.contribution),money(x.surplus)])))}</section>`
  +`<div class="grid2">${Object.entries(s.products).map(([product,p])=>`<section class="panel"><h2>${productNames[product]}</h2><div class="progress-step"><span>תקבולים ללא מע״מ החודש</span><b>${money(p.net_receipts)}</b></div><div class="progress-step"><span>דקות בשיחות משויכות</span><b>${p.minutes}</b></div><div class="progress-step"><span>עלות AI משוערת</span><b>${money(p.ai_cost)}</b></div><div class="progress-step"><span>תרומה צפויה ללקוח</span><b>${money(p.forecast_contribution)}</b></div>${table(["לקוחות","תרומה צפויה"],p.scenarios.map(x=>row([x.customers,money(x.contribution)])))}</section>`).join("")}</div>`
  +`<section class="panel"><div class="panel-head"><h2>הנחות המודל</h2>${badge("ניתן לעריכה")}</div><form id="economicsForm"><div class="form-grid">${Object.entries(labels).map(([key,label])=>field(key,label,e[key],"number")).join("")}</div><div class="actions"><button class="primary">שמירת הנחות וחישוב מחדש</button></div></form></section>`
  +`<div class="notice">${s.notes.map(esc).join("<br>")}<br>הגדרות אלה הן הנחות ניהוליות הניתנות לעריכה, ולא אימות מס או מחירי ספק עדכניים.</div>`;
 },
 async connections(){
  state.bots=(await api("/v1/admin/profiles")).profiles;
  return head("ערוצים וחיבורים","כתובות הקצה והמצב האמיתי של כל חיבור.")
  +`<section class="panel"><div class="panel-head"><h2>טכנוליין · שיחות קול</h2>${badge("נתיבי שרת קיימים")}</div>${table(["בוט","ערוץ מוגדר","כתובת קצה"],state.bots.map(b=>row([esc(b.label),b.channel_configured?"כן":"לא",`<code dir="ltr">${esc(location.origin.replace(/^http/,"ws")+b.websocket_path)}</code>`])))}
  <p class="notice">כתובת קיימת אינה הוכחה שהשלוחה בטכנוליין מחוברת אליה. יש להגדיר את הערוץ ולבצע שיחת בדיקה.</p></section>
  <section class="panel"><h2>אתר, חבילות וקריינות</h2>${[["אזור התלמיד","מחובר ב־/learn · קישור אישי מופק מתוך תיק הלקוח"],["אכיפת דקות ומכסות","מחוברת לטלפון ולאתר · מופעלת לכל בוט בנפרד"],["יצירת קריינות","ייצור WAV, האזנה והורדה דרך ספריית הקריינות"]].map(([a,b])=>`<div class="progress-step"><div><h3>${a}</h3><p>${b}</p></div>${badge("מחובר")}</div>`).join("")}</section>
  <section class="panel"><h2>חיבורים חיצוניים</h2>${[["סליקה אוטומטית","נדרשים ספק סליקה ופרטי החיבור שלו. אפשר לרשום תשלום מאומת ידנית."],["פרסום קריינות ותפריטים בטכנוליין","ניתן להוריד קובץ ולשייך שלוחה. העלאה אוטומטית וכוכבית לבחירת שפה עדיין אינן מחוברות."]].map(([a,b])=>`<div class="progress-step"><div><h3>${a}</h3><p>${b}</p></div>${badge("ממתין לחיבור","warn")}</div>`).join("")}</section>`;
 }
};
const latencyLabels={session_started:"תחילת שיחה",configuration_loaded:"טעינת הגדרות",prompt_compiled:"הרכבת הפרומפט",gemini_connect_started:"תחילת חיבור ל־Gemini",gemini_connected:"Gemini מחובר",greeting_sent:"שליחת פתיחה",first_pbx_audio:"אודיו ראשון מהטלפון",first_gemini_audio:"אודיו ראשון מהמודל",first_audio_sent_to_phone:"אודיו ראשון שנשלח לטלפון",learner_transcript_ready:"התחלת תמליל לקוח",tutor_transcript_started:"התחלת תמליל בוט",tutor_turn_complete:"סיום תשובת הבוט",tutor_interrupted:"קטיעת תשובה",session_saved:"שמירת שיחה"};
const botTabs=[["identity","זהות וניתוב"],["prompt","פרומפט ופתיחה"],["speech","קול, דיבור ו־VAD"],["context","תמלול והקשר"],["access","דקות ומכסות"],["preview","מה נשלח ל־AI"],["versions","גרסאות"]];
async function botView(){
 state.data=await api("/v1/admin/config/"+encodeURIComponent(state.bot));
 const d=state.data,b=d.profile,c={...d.controls,...(state.drafts[state.bot]||{})};
 let body="";
 if(state.tab==="identity")body=`<div class="form-grid">${field("label","שם תצוגה",b.label)}${field("role","תפקיד",b.role,"text","",false,Object.entries(roleNames))}${field("audience","קהל",b.audience)}${field("channel_id","מזהה ערוץ פרטי · אופציונלי",b.channel_id||"","text","הנתב המשותף אינו דורש ערוץ פרטי לכל בוט.")}${field("description","תיאור",b.description,"textarea","",true)}${field("enabled","בוט פעיל",b.enabled,"checkbox")}${field("phone_enabled","פעיל בטלפון",b.phone_enabled,"checkbox","מופיע אוטומטית בבחירת המורים בקו.")}${field("web_enabled","פעיל באתר",b.web_enabled,"checkbox")}</div><p class="notice">כתובת הבוט: <code dir="ltr">${esc(location.origin.replace(/^http/,"ws")+b.websocket_path)}</code></p>`;
 if(state.tab==="prompt")body=`<div class="form-grid">${field("base_prompt","פרומפט המערכת",c.base_prompt,"textarea","מקור ההנחיות של הבוט. שמירה מפרסמת גרסה לשיחות הבאות.",true)}${field("opening_message","הוראת פתיחה ל־AI",c.opening_message,"textarea","זו הוראה ליצירת דיבור, ולא הקלטה קבועה שהמאזין ישמע מילה במילה.",true)}${field("learning_goal","מטרה",c.learning_goal,"textarea")}${field("custom_instructions","הוראות נוספות",c.custom_instructions,"textarea")}${field("target_lesson_minutes","משך יעד בדקות",c.target_lesson_minutes,"number")}${field("max_call_minutes","מגבלת שיחה טכנית",c.max_call_minutes,"number")}${field("ending_policy","מדיניות סיום",c.ending_policy,"text","",false,[["learner_only","רק לבקשת התלמיד"],["after_target_with_permission","לאחר היעד ובהסכמה"],["model_discretion","לפי שיקול דעת המורה"]])}</div>`;
 if(state.tab==="speech")body=`<div class="form-grid">${field("model","מודל Gemini",c.model,"text","יש לבחור מזהה מודל Live שזמין בחשבון שלך.")}${field("voice","קול",c.voice,"text","",false,d.options.voices)}${field("language_code","שפת הפלט שנשלחת ל־Google",c.language_code,"text","למשל he-IL או en-US")}${field("temperature","יצירתיות",c.temperature??"","number","0–2; ריק משתמש בברירת המודל")}
 ${field("vad_start_sensitivity","רגישות תחילת דיבור",c.vad_start_sensitivity,"text","נמוכה מפחיתה זיהוי של רעש כדיבור.",false,[["START_SENSITIVITY_LOW","נמוכה"],["START_SENSITIVITY_HIGH","גבוהה"]])}
 ${field("vad_end_sensitivity","רגישות סיום דיבור",c.vad_end_sensitivity,"text","",false,[["END_SENSITIVITY_LOW","נמוכה"],["END_SENSITIVITY_HIGH","גבוהה"]])}
 ${field("vad_prefix_ms","אודיו מקדים לזיהוי דיבור (מ״ש)",c.vad_prefix_ms,"number","prefixPaddingMs: אודיו שמקדים את תחילת הדיבור המזוהה.")}${field("vad_silence_ms","שקט לסיום תור (מ״ש)",c.vad_silence_ms,"number","יותר זמן מאפשר לחשוב; פחות זמן עשוי להאיץ תגובה.")}
 ${field("activity_handling","קטיעת הבוט כשלקוח מדבר",c.activity_handling,"text","",false,[["START_OF_ACTIVITY_INTERRUPTS","לקטוע את תשובת הבוט"],["NO_INTERRUPTION","לא לקטוע"]])}
 ${field("turn_coverage","מה נכלל בתור",c.turn_coverage,"text","",false,d.options.turn_coverage)}
 ${field("input_batch_frames","מספר מסגרות אודיו לפני שליחה",c.input_batch_frames,"number","במסגרות של 20 מ״ש, 5 מסגרות מוסיפות עד 100 מ״ש לצבירה.")}</div><div class="notice">VAD אוטומטי פעיל. אין כאן בקרת מהירות דיבור מספרית; הנחיית ״דבר לאט״ נכתבת בפרומפט ואינה הבטחת מהירות מדויקת.</div>`;
 if(state.tab==="context")body=`<div class="form-grid">${field("transcription_mode","מצב תמלול",c.transcription_mode,"text","",false,d.options.transcription_mode)}${field("transcription_language_codes","רמזי שפה לתמלול",c.transcription_language_codes.join(","),"text","מופרדים בפסיק")}${field("custom_vocabulary","אוצר מילים מותאם",c.custom_vocabulary.join("\n"),"textarea","מונח אחד בכל שורה",true)}${field("context_trigger_tokens","סף דחיסת הקשר",c.context_trigger_tokens,"number")}${field("context_target_tokens","יעד לאחר דחיסה",c.context_target_tokens,"number")}${field("store_transcripts","עותק תמליל נוסף בסיכום",c.store_transcripts,"checkbox","לוג הקלט והפלט נשמר בנפרד.")}</div>`;
 if(state.tab==="preview")body=`<p class="notice">זו תצוגת ההגדרות שפורסמו. בשיחה עצמה מצטרפים ההיסטוריה והשיעור של הלקוח המסוים; ההעתק שנשלח נשמר בלוג השיחה.</p><h3>פרומפט מערכת</h3><pre>${esc(d.effective.setup_message.setup.systemInstruction.parts[0].text)}</pre><details><summary>כל הודעת ה־Setup</summary><pre>${esc(JSON.stringify(d.effective.setup_message,null,2))}</pre></details><details><summary>הוראת הפתיחה</summary><pre>${esc(JSON.stringify(d.effective.opening_client_message,null,2))}</pre></details>`;
 if(state.tab==="versions"){const versions=(await api(`/v1/admin/bots/${encodeURIComponent(state.bot)}/versions`)).versions;body=table(["גרסה","מועד פרסום",""],versions.map(v=>row([badge("v"+v.version),date(v.created_at),`<button class="ghost" data-restore="${v.version}">פרסום מחדש של גרסה זו</button>`])))}
 if(state.tab==="access"){
  const policies=(await business("policies")).items;
  const p=policies.find(x=>x.id===state.bot)||{enabled:false,product:b.role==="translator"?"translator":"school",free_calls_month:b.role==="translator"?3:0,free_call_seconds:60,blocked_extension:"/"};
  body=`<div class="notice">הפעלת המדיניות אוכפת יתרת חבילה ותוקף, או מכסת שיחות חינם. כשהיתרה נגמרת המתקשר מועבר לשלוחה שבחרת. יש להכין את הודעת המכירה והתשלום בשלוחה זו בטכנוליין.</div><div class="form-grid">${field("enabled","הפעלת אכיפת שימוש",p.enabled,"checkbox")}${field("product","מוצר לחיוב",p.product,"text","",false,Object.entries(productNames))}${field("free_calls_month","שיחות חינם לאדם בחודש",p.free_calls_month,"number")}${field("free_call_seconds","אורך שיחה חינמית בשניות",p.free_call_seconds,"number")}${field("blocked_extension","שלוחה להעברה כשהמכסה הסתיימה",p.blocked_extension,"text","שלוחה מוחלטת, למשל /sales")}</div>`;
 }
 return head(b.label,"עריכה וניהול · "+(roleNames[b.role]||b.role)+" · גרסה "+b.active_version,'<div class="actions"><button class="ghost" data-action="duplicateBot">שכפול הבוט</button><a class="ghost" href="#bots">חזרה לבוטים</a></div>')
 +`<div class="tabs">${botTabs.map(([id,label])=>`<button class="tab ${state.tab===id?"active":""}" data-tab="${id}">${label}</button>`).join("")}</div><section class="panel"><form id="botForm">${body}${["preview","versions"].includes(state.tab)?"":`<div class="actions">${["identity","access"].includes(state.tab)?"":'<button type="button" class="ghost" id="tryPrompt">תצוגה ללא פרסום</button>'}<button class="primary" type="submit">שמירת שינויים</button></div>`}</form></section><div id="draftPreview"></div>`;
}
function botControls(){
 const v=readFields($("botForm")), c={...state.data.controls,...(state.drafts[state.bot]||{})};
 for(const [k,val] of Object.entries(v))if(k in c)c[k]=val;
 if(typeof c.transcription_language_codes==="string")c.transcription_language_codes=c.transcription_language_codes.split(",").map(s=>s.trim()).filter(Boolean);
 if(typeof c.custom_vocabulary==="string")c.custom_vocabulary=c.custom_vocabulary.split("\n").map(s=>s.trim()).filter(Boolean);
 return c;
}
function bind(){
 if($("ivrCopyForm"))$("ivrCopyForm").onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;try{await api("/v1/admin/pbx/config","PUT",readFields(e.target));toast("הנוסחים נשמרו ויחולו בפנייה הבאה מהקו")}catch(err){toast(err.message)}finally{e.submitter.disabled=false}};
 $("search")?.addEventListener("input",e=>{const q=e.target.value.toLowerCase();$("content").querySelectorAll("tbody tr,.trace").forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(q))});
 $("logBot")?.addEventListener("change",e=>{state.logBot=e.target.value;render()});
 $("content").querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{if(["prompt","speech","context"].includes(state.tab))state.drafts[state.bot]=botControls();state.tab=b.dataset.tab;render()});
 $("content").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>editRecord(b.dataset.edit,state.items.find(x=>x.id===b.dataset.id)));
 $("content").querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>actions[b.dataset.action]());
 $("content").querySelectorAll("[data-audio]").forEach(b=>b.onclick=()=>renderNarration(b));
 $("content").querySelectorAll("[data-enroll]").forEach(b=>b.onclick=()=>{const e=state.enrollmentItems.find(x=>x.id===b.dataset.enroll),c=state.courseLists.courses.find(x=>x.id===e.course_id);dialog("עדכון התקדמות",field("lesson_index","שיעור",e.lesson_index,"text","",false,c.lessons.map((l,i)=>[i,(i+1)+" · "+l.title]))+field("status","מצב הלמידה",e.status,"text","",false,[["active","בלמידה"],["completed","הושלם"],["paused","בהשהיה"]]),v=>business("enrollments/"+e.id,"PUT",{...e,...v,lesson_index:Number(v.lesson_index)}))});
 $("content").querySelectorAll("[data-restore]").forEach(b=>b.onclick=async()=>{if(!confirm("לפרסם מחדש את גרסה "+b.dataset.restore+"? השינוי יחול בשיחות חדשות."))return;try{await api(`/v1/admin/bots/${encodeURIComponent(state.bot)}/restore/${b.dataset.restore}`,"POST");toast("פורסמה גרסה חדשה");await render()}catch(e){toast(e.message)}});
 if($("botForm"))$("botForm").onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;try{
  if(state.tab==="identity"){const b={...state.data.profile,...readFields($("botForm"))};await api("/v1/admin/bots/"+encodeURIComponent(state.bot),"PUT",b)}
  else if(state.tab==="access")await business("policies/"+encodeURIComponent(state.bot),"PUT",readFields($("botForm")));
  else {await api("/v1/admin/config/"+encodeURIComponent(state.bot),"PUT",botControls());delete state.drafts[state.bot]}
  toast("השינויים נשמרו");await render();
 }catch(err){toast(err.message)}finally{e.submitter.disabled=false}};
 if($("tryPrompt"))$("tryPrompt").onclick=async()=>{try{const d=await api(`/v1/admin/bots/${encodeURIComponent(state.bot)}/preview`,"POST",botControls());$("draftPreview").innerHTML=`<section class="panel"><h2>בדיקת הנוסח · ללא פרסום</h2><pre>${esc(JSON.stringify(d.setup_message,null,2))}</pre></section>`}catch(e){toast(e.message)}};
 if($("economicsForm"))$("economicsForm").onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;try{await business("economics","PUT",readFields($("economicsForm")));toast("ההנחות נשמרו");await render()}catch(err){toast(err.message)}finally{e.submitter.disabled=false}};
}
const actions={
 async syncPbx(){try{toast("מסנכרן ומאמת את שלוחה 99…");const d=await api("/v1/admin/pbx/reconcile","POST");toast(`אומתו ${d.verified.length} שלוחות; התפריט הראשי לא השתנה`);await render()}catch(e){toast(e.message)}},
 publishNarration(){dialog("פרסום קריינות במערכת הטלפונית",field("narration_id","קריינות מאושרת","","text","יש לייצר אודיו ולאשר את הנוסח לפני הפרסום.",false,state.items.filter(n=>n.status==="approved").map(n=>[n.id,n.name]))+field("slot","מיקום בתפריט","welcome","text","הפרסום מעדכן גם את נוסח התפריט.",false,[["welcome","פתיחה"],["school","בית הספר"],["translator","תרגומון"],["languages","שפות"],["school_mode","סוג למידה"],["sales","מידע וחבילות"],["service","שירות"],["thanks","אישור הודעה"],["quota","סיום מכסה"]]),v=>api(`/v1/admin/narrations/${encodeURIComponent(v.narration_id)}/publish-to-ivr`,"POST",{slot:v.slot}))},
 duplicateBot(){const b=state.data.profile;dialog("שכפול הבוט",field("id","מזהה חדש באנגלית")+field("label","שם הבוט",b.label+" · עותק"),async v=>{const r=await api(`/v1/admin/bots/${encodeURIComponent(b.id)}/duplicate`,"POST",{...v,role:b.role,audience:b.audience,enabled:false});state.tab="prompt";location.hash="bots/"+r.bot.id})},
 newBot(){dialog("יצירת בוט חדש",field("id","מזהה קבוע באנגלית","","text","אותיות קטנות, מספרים ומקפים")+field("label","שם הבוט")+field("role","תפקיד","teacher","text","",false,Object.entries(roleNames)),async v=>{const r=await api("/v1/admin/bots","POST",v);state.tab="prompt";location.hash="bots/"+r.bot.id})},
 newCustomer(){editRecord("customers")},
 newCourse(){editRecord("courses")},
 newPackage(){editRecord("packages")},
 newNarration(){editRecord("narrations")},
 newEnrollment(){const l=state.courseLists;dialog("שיוך תלמיד למסלול",field("customer_id","לקוח","","text","",false,l.customers.map(x=>[x.id,x.name]))+field("course_id","מסלול","","text","",false,l.courses.map(x=>[x.id,x.name]))+field("lesson_number","השיעור שבו מתחילים",1,"number"),v=>{const {lesson_number,...rest}=v;return business("enrollments","POST",{...rest,lesson_index:lesson_number-1})})},
 newReceipt(){const l=state.receiptLists;dialog("רישום תשלום שהתקבל",`<p class="notice warn">יש לרשום רק תשלום שקיבלת ואימתת. אסמכתה כפולה תידחה.</p>`+field("customer_id","לקוח","","text","",false,l.customers.map(x=>[x.id,x.name]))+field("package_id","חבילה","","text","",false,l.packages.filter(x=>x.active).map(x=>[x.id,x.name]))+field("reference","אסמכתה חיצונית")+field("amount_ils","סכום ששולם כולל מע״מ",0,"number"),v=>business("receipts","POST",v))}
};
function editRecord(kind,item={}){
 let fields="",title="";
 if(kind==="customers"){title="פרטי לקוח";fields=field("name","שם",item.name)+field("phone","טלפון",item.phone)+field("source","מקור הגעה",item.source||"organic")+field("preferred_bot","מורה מועדף",item.preferred_bot||"","text","שמירת העדפה; ניתוב השלוחה אינו משתנה אוטומטית.",false,[["","לא נבחר"],...state.bots.map(b=>[b.id,b.label])])+field("notes","הערות",item.notes,"textarea")}
 if(kind==="packages"){title="הגדרת חבילה";fields=field("name","שם",item.name)+field("product","מוצר",item.product||"school","text","",false,Object.entries(productNames))+field("minutes","דקות בחבילה",item.minutes||100,"number")+field("price_ils","מחיר כולל מע״מ",item.price_ils||0,"number")+field("validity_days","תוקף בימים",item.validity_days||30,"number")+field("active","חבילה פעילה",item.active||false,"checkbox")}
 if(kind==="narrations"){title="עריכת קריינות";fields=field("name","שם",item.name)+field("placement","מיקום בחוויה",item.placement||"welcome","text","",false,[["welcome","פתיחה"],["language_menu","בחירת שפה"],["quota","מכסה"],["upsell","הצעה לבית הספר"],["service","שירות"],["other","אחר"]])+field("text","הנוסח המלא",item.text,"textarea")+field("language","שפה",item.language||"he-IL")+field("technoline_extension","שלוחה בטכנוליין",item.technoline_extension)+field("status","מצב עריכה",item.status||"draft","text","אישור אינו מפרסם בטכנוליין.",false,[["draft","טיוטה"],["approved","נוסח מאושר"]])}
 if(kind==="courses"){
  title="מסלול ושיעורים";fields=field("name","שם המסלול",item.name)+field("level","רמה",item.level||"basic")+field("bot_id","מורה",item.bot_id||"","text","",false,[["","לא נבחר"],...state.bots.map(b=>[b.id,b.label])])+field("active","מסלול פעיל",item.active||false,"checkbox");
  fields+=`<div id="lessonRows">${(item.lessons?.length?item.lessons:[{title:"",goal:"",instructions:"",passing_score:3}]).map((l,i)=>lessonFields(l,i)).join("")}</div><button type="button" class="ghost" id="addLesson">＋ הוספת שיעור</button>`;
 }
 if(kind==="narrations")fields+=field("bot_id","הקול והמודל לפי הבוט",item.bot_id||"","text","",false,[["","ברירת המערכת"],...state.bots.map(b=>[b.id,b.label])]);
 if(kind==="customers"&&item.id)fields+=`<div class="actions"><button type="button" class="ghost" id="customerDetail">שיחות ויתרות</button><button type="button" class="ghost" id="customerInvite">קישור כניסה לאזור התלמיד</button></div><div id="customerExtra"></div>`;
 dialog(title,fields,async v=>{
  if(kind==="courses"){v.lessons=[...$("lessonRows").querySelectorAll(".lesson-editor")].map(el=>({title:el.querySelector(".lesson-title").value,goal:el.querySelector(".lesson-goal").value,instructions:el.querySelector(".lesson-instructions").value,passing_score:Number(el.querySelector(".lesson-score").value)}))}
  await business(kind+(item.id?"/"+item.id:""),item.id?"PUT":"POST",v);
 });
 if(kind==="customers"&&item.id){
  $("customerDetail").onclick=async()=>{try{const d=await business(`customers/${encodeURIComponent(item.id)}/detail`);$("customerExtra").innerHTML=`<h3>יתרות בחבילות</h3>${d.receipts.map(r=>`<div class="progress-step"><span>${productNames[r.product]} · ${new Date(r.expires_at)>new Date()?"בתוקף":"פג תוקף"}</span><b>${Math.max(0,r.minutes-r.spent_seconds/60).toFixed(1)} דקות</b></div>`).join("")||"אין חבילות"}<h3>שיחות אחרונות</h3>${d.calls.map(c=>`<div class="progress-step"><div><b>${esc(date(c.created_at))}</b><p>${esc(c.summary_he||"שיחה ללא סיכום")}</p></div><span>${esc(c.channel)}</span></div>`).join("")||"אין שיחות"}`}catch(e){$("editorError").textContent=e.message}};
  $("customerInvite").onclick=async()=>{try{const d=await business(`customers/${encodeURIComponent(item.id)}/invite`,"POST");const url=location.origin+"/learn#"+d.token;$("customerExtra").innerHTML=`<p class="notice">קישור אישי ל־7 ימים. יצירת קישור חדש מבטלת את הקודם. מסור אותו רק ללקוח הזה.</p><input readonly id="inviteUrl" dir="ltr" value="${esc(url)}"><a class="ghost" href="${esc(url)}" target="_blank" rel="noreferrer">פתיחת האזור האישי</a>`}catch(e){$("editorError").textContent=e.message}};
 }
 if(kind==="courses")$("addLesson").onclick=()=>$("lessonRows").insertAdjacentHTML("beforeend",lessonFields({title:"",goal:"",instructions:"",passing_score:3},$("lessonRows").children.length));
}
function lessonFields(l,i){return `<section class="lesson-editor panel"><h3>שיעור ${i+1}</h3><label>כותרת<input class="lesson-title" value="${esc(l.title)}" required></label><label>מטרה<input class="lesson-goal" value="${esc(l.goal)}"></label><label>הנחיות למורה<textarea class="lesson-instructions">${esc(l.instructions)}</textarea></label><label>ציון יעד (1–5)<input class="lesson-score" type="number" min="1" max="5" value="${l.passing_score}"></label></section>`}
async function renderNarration(button){
 button.disabled=true;const label=button.textContent;button.textContent="מייצר אודיו…";
 try{const r=await fetch(`/v1/admin/narrations/${encodeURIComponent(button.dataset.audio)}/audio`,{method:"POST",headers:{Authorization:"Bearer "+state.token}});if(!r.ok){const b=await r.json();throw Error(b.detail||"יצירת הקריינות נכשלה")};const url=URL.createObjectURL(await r.blob());dialog("הקריינות מוכנה",`<p>האזן ואשר את ההגייה לפני שימוש בקו. הקובץ הוא WAV חד־ערוצי ב־8kHz.</p><audio controls src="${url}"></audio><a class="ghost" href="${url}" download="narration.wav">הורדת הקריינות</a>`,async()=>{});toast("הקריינות נוצרה ונשמרה")}catch(e){toast(e.message)}finally{button.disabled=false;button.textContent=label}
}
const narrationLibrary=views.narrations;
views.narrations=async()=>await narrationLibrary()+`<section class="panel"><h2>מהספרייה אל הקו הטלפוני</h2><p>לאחר יצירת אודיו ואישור הנוסח, אפשר לפרסם אותו במיקום הנבחר בתפריט. טכנוליין מקבלת קישור לקובץ מהשרת, ללא העלאה ידנית. שינוי הטקסט מבטל שימוש בהקלטה הישנה עד לפרסום מחדש.</p><button class="primary" data-action="publishNarration">פרסום קריינות בקו</button></section>`;
views.pbx=async()=>{
 const c=await api("/v1/admin/pbx/config"), events=(await api("/v1/admin/pbx/events")).events;
 let live,error;try{live=await api("/v1/admin/pbx/status")}catch(e){error=e.message}
 const labels={welcome:"פתיחת המערכת",school:"בחירת מורה",school_mode:"קורס או שיחה חופשית",translator:"פתיחת התרגומון",languages:"בחירת שפת יעד · מקש 9",sales:"מידע וחבילות",service:"השארת הודעה",thanks:"אישור קבלת הודעה",quota:"סיום מכסה"};
 return head("המרכזייה החיה","הניהול מבודד לשלוחה "+c.project_path+" בלבד. אין שינוי בתפריט הראשי או בהפניית המתקשרים.",'<button class="primary" data-action="syncPbx">סנכרון ואימות מול טכנוליין</button>')
 +`<section class="metrics">${metric("מספר המערכת",c.phone,"ההפניה לשלוחה נשארת בידיך",true)}${metric("שלוחת המיזם",c.project_path,live?"נבדקה מול טכנוליין":"טרם אומתה")}${metric("חיבור ניהול",live?"מחובר":"לא אומת",error||"בדיקת API אמיתית")}${metric("אירועי תפריט",events.length,"ללא נתוני הדגמה")}</section>`
 +`<p class="notice warn">סליקה אוטומטית אינה מוגדרת. מקש 9 פועל לפני הכניסה לשיחת התרגום; בזמן סטרימינג טכנוליין אינה מעבירה כיום הקשות. אפשר לבקש שינוי שפה בקול. בית הספר במצב הרצה: עד 10 דקות לשיחה, ללא גבייה אוטומטית. בתרגומון מוגדרות שתי שיחות חינם של 30 שניות בחודש, לאדם.</p>`
 +`<section class="panel"><div class="panel-head"><h2>כל מילה בחוויה הטלפונית</h2>${badge("עריכה חיה")}</div><p>שינויים נשמרים בשרת. אין צורך לפרוס מחדש או לערוך בטכנוליין. טקסטים אלה מוקראים כרגע באמצעות מנגנון ההקראה של טכנוליין.</p><form id="ivrCopyForm"><div class="form-grid">${Object.entries(c.copy).map(([key,value])=>field(key,labels[key]||key,value,"textarea","",true)).join("")}</div><div class="actions"><button class="primary">שמירת הנוסחים לקו</button></div></form></section>`
 +`<section class="panel"><h2>סנכרון הבוטים</h2><p>כל מורה פעיל לטלפון מופיע אוטומטית בתפריט. הוספה, שינוי שם וכיבוי בפאנל משתקפים בקו ללא הקמת ערוץ ידנית. נתב הסטרימינג המשותף טוען את הגרסה העדכנית של הבוט שנבחר.</p><p>${c.managed_channel_configured?"הנתב מוגדר בשרת":"הנתב טרם הוגדר"} · <a href="#bots">ניהול הבוטים והערוצים</a></p></section>`
 +`<section class="panel"><h2>מסלולי השיחה</h2>${table(["שלוחה","תפקיד"],[["/99","תפריט כניסה"],["/99/1","בית הספר"],["/99/1/1","בחירת מורה דינמית"],["/99/2","תרגומון"],["/99/2/9","בחירת שפה"],["/99/3","מידע וחבילות"],["/99/4","הודעה לשירות"],["/99/5","קורס או שיחה חופשית"],["/99/7","נתב בוטים משותף"],["/99/8","סיום מכסה"]].map(([a,b])=>row([`<code>${a}</code>`,b])))}</section>`
 +`<section class="panel"><h2>תנועה ושיחות · נתוני טכנוליין</h2>${live?`<details><summary>פתיחת דוח כניסות לשלוחה</summary><pre>${esc(JSON.stringify(live.visits,null,2))}</pre></details>`:empty("החיבור טרם אומת",error||"הגדר חיבור בשרת")}</section>`
 +`<section class="panel"><h2>לוג תפריטים · קלט, פלט וזמן תגובה</h2>${events.length?table(["מועד","שלב","זמן טיפול","פירוט"],events.slice(0,100).map(x=>row([esc(date(x.at)),esc(x.route),esc(x.latency_ms)+" מ״ש",`<details><summary>קלט ופלט</summary><pre>${esc(JSON.stringify(x,null,2))}</pre></details>`]))):empty("אין שיחות עדיין","הלוג יתמלא לאחר כניסת מתקשרים לשלוחה.")}</section>`;
};
if(state.token)start().catch(e=>{$("loginError").textContent=e.message});
