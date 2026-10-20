"use strict";
const $=id=>document.getElementById(id),esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let token=location.hash.slice(1)||sessionStorage.getItem("learnerToken")||"";
history.replaceState(null,"","/learn");
async function request(path,body){const r=await fetch(path,{method:body?"POST":"GET",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.detail||"לא ניתן להתחבר");return data}
async function load(){
 const d=await request("/v1/portal/me");sessionStorage.setItem("learnerToken",token);
 $("entry").hidden=true;$("lessonApp").hidden=false;$("name").textContent="שלום, "+d.customer.name;
 $("stats").innerHTML=[["נקודות",d.progress.total_points],["שיחות",d.progress.session_count],["דקות תרגול",d.progress.total_minutes],["חבילות בתוקף",d.receipts.filter(r=>new Date(r.expires_at)>new Date()).length]].map(([a,b])=>`<div class="metric"><p>${a}</p><div class="value">${b}</div></div>`).join("");
 $("teacher").innerHTML=d.bots.map(b=>`<option value="${esc(b.id)}">${esc(b.label)}</option>`).join("");
 if(d.bots.some(b=>b.id===d.customer.preferred_bot))$("teacher").value=d.customer.preferred_bot;
 if(!$("learningMode"))$("teacher").parentElement.insertAdjacentHTML("afterend",'<label>סוג השיחה<select id="learningMode"><option value="course">קורס מובנה</option><option value="free">שיחה חופשית</option><option value="translation">תרגום</option></select></label><label>שפת יעד לתרגום<select id="translationLanguage"><option value="">ברירת המחדל</option><option value="English">אנגלית</option><option value="Hebrew">עברית</option><option value="Yiddish">יידיש</option><option value="Arabic">ערבית</option><option value="Russian">רוסית</option><option value="French">צרפתית</option></select></label><p id="preferenceStatus" role="status"></p>');
 $("learningMode").value=d.preferences?.mode||"course";$("translationLanguage").value=d.preferences?.language||"";
 const save=async()=>{try{await request("/v1/portal/preferences",{selected_bot:$("teacher").value,mode:$("learningMode").value,language:$("translationLanguage").value});$("preferenceStatus").textContent="ההעדפות נשמרו גם לשיחה הבאה בטלפון."}catch(e){$("error").textContent=e.message}};
 $("teacher").onchange=save;$("learningMode").onchange=save;$("translationLanguage").onchange=save;
 $("history").innerHTML=d.calls.map(c=>`<div class="progress-step"><div><b>${esc(new Date(c.created_at).toLocaleString("he-IL"))}</b><p>${esc(c.summary_he||"שיחה בתהליך")}</p></div></div>`).join("")||"אין עדיין שיחות. אפשר להתחיל כאן או בטלפון.";
}
$("entryForm").onsubmit=async e=>{e.preventDefault();token=$("portalToken").value;try{await load();$("error").textContent=""}catch(err){$("error").textContent=err.message}};
$("exit").onclick=()=>{sessionStorage.removeItem("learnerToken");location.reload()};
$("turnForm").onsubmit=async e=>{e.preventDefault();$("send").disabled=true;$("error").textContent="";const text=$("message").value;try{const d=await request("/v1/bots/"+encodeURIComponent($("teacher").value)+"/turn",{text});$("conversation").insertAdjacentHTML("beforeend",`<div class="bubble">${esc(text)}</div><div class="bubble output">${esc(d.text)}</div>`);const bytes=Uint8Array.from(atob(d.audio_wav_base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:"audio/wav"}));const audio=document.createElement("audio");audio.controls=true;audio.src=url;$("conversation").append(audio);audio.play().catch(()=>{});$("message").value=""}catch(err){$("error").textContent=err.message}finally{$("send").disabled=false}};
if(token)load().catch(e=>$("error").textContent=e.message);
