"use strict";
const form = document.getElementById("callback");
const status = document.getElementById("status");
const whenRow = document.getElementById("whenRow");
const source = (new URLSearchParams(location.search).get("src") || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
form.addEventListener("change", () => { whenRow.hidden = form.timing.value !== "scheduled"; });
function say(text, kind) { status.textContent = text; status.className = kind; }
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const phone = form.phone.value.replace(/[^0-9+]/g, "");
  if (!form.name.value.trim()) return say("נא למלא שם.", "err");
  if (!/^(\+972|972|0)(5[0-9]|7[0-9])[0-9]{7}$/.test(phone)) return say("נא למלא מספר טלפון תקין.", "err");
  if (!form.consent.checked) return say("כדי שנתקשר, צריך לסמן אישור לקבלת השיחה.", "err");
  const button = document.getElementById("submit");
  button.disabled = true; say("שולח…", "");
  try {
    const response = await fetch("/v1/public/callback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      name: form.name.value, phone, for_whom: form.for_whom.value, goal: form.goal.value, timing: form.timing.value,
      preferred_time: form.preferred_time.value, consent: true, source, website: form.website.value,
    }) });
    if (!response.ok) throw new Error(String(response.status));
    const scheduled = form.timing.value === "scheduled";
    form.reset(); whenRow.hidden = true;
    say(scheduled ? "קיבלנו. נתקשר בזמן שביקשתם." : "קיבלנו! המורה תתקשר אליכם בהקדם.", "ok");
  } catch { say("משהו השתבש. נסו שוב בעוד רגע.", "err"); }
  finally { button.disabled = false; }
});
