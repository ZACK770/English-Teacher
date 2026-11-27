const html = `<!doctype html>
<html lang="he" dir="rtl">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>כוונון שלוחה 888</title>
<style>
body{font:1rem system-ui,sans-serif;margin:2rem auto;padding:0 1rem;max-width:34rem;color:#17243b}
label{display:block;margin:1rem 0}input{display:block;width:100%;box-sizing:border-box;padding:.5rem;direction:ltr}
button{font:inherit;padding:.45rem;margin:.15rem}
</style>
<main>
<h1>כוונון שלוחה 888</h1>
<p>שינוי מודל או קול חל על החיוג הבא.</p>
<label>מפתח ניהול הפיילוט<input id="token" type="password" autocomplete="off"></label>
<label>מודל OpenRouter<input id="model" maxlength="150"></label>
<label>קול Inworld<input id="voice" maxlength="100"></label>
<button id="load">טען הגדרה פעילה</button>
<button id="save">שמור לחיוג הבא</button>
<button id="rollback">חזור להגדרה הקודמת</button>
<p id="status" role="status"></p>
</main>
<script>
const element = id => document.getElementById(id);
const buttons = ['load', 'save', 'rollback'].map(element);
async function update(method, settings) {
  const token = element('token').value.trim();
  if (!token) {
    element('status').textContent = 'הזן מפתח ניהול.';
    return;
  }
  buttons.forEach(button => { button.disabled = true; });
  try {
    const response = await fetch('/v1/admin/pilot/settings', {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: settings ? JSON.stringify(settings) : undefined
    });
    if (response.status === 401) throw new Error('מפתח הניהול שגוי.');
    if (response.status === 409) throw new Error('אין הגדרה קודמת.');
    if (!response.ok) throw new Error('הפעולה לא הושלמה (' + response.status + ').');
    const data = await response.json();
    element('model').value = data.active.model;
    element('voice').value = data.active.voice;
    element('status').textContent = method === 'GET' ? 'ההגדרה הפעילה נטענה.' : 'ההגדרה פעילה לחיוג הבא.';
  } catch (error) {
    element('status').textContent = error.message;
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}
element('load').onclick = () => update('GET');
element('save').onclick = () => update('PUT', {
  model: element('model').value.trim(), voice: element('voice').value.trim()
});
element('rollback').onclick = () => update('PUT', { rollback: true });
</script>
</html>`;

export function pilotSettingsPage(): Response {
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
  } });
}
