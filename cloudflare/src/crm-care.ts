import { type Env, HttpError } from "./env";

export interface CareItem {
  id: string;
  customer: string;
  kind: "callback" | "task" | "note";
  title: string;
  due: string;
  closed?: string;
  by?: string;
  outcome?: string;
}

export async function saveCare(request: Request, env: Env, customer: string, by: string, items: CareItem[]) {
  const input = await request.json() as Record<string, unknown>;
  const title = String(input.title || "").trim();
  const due = String(input.due || "");
  const validDay = /^\d{4}-\d{2}-\d{2}$/.test(due) && Number.isFinite(Date.parse(due)) && new Date(due).toISOString().startsWith(due);
  const now = new Date().toISOString();
  let item: CareItem;
  const previous = items.find(i => i.id === input.id);
  if (input.action === "close" || input.action === "postpone") {
    if (!previous || previous.closed || previous.kind === "note") throw new HttpError(409, "הטיפול השתנה. יש לרענן.");
    if (input.action === "postpone" && !validDay) throw new HttpError(400, "יש לבחור תאריך");
    item = input.action === "close" ? { ...previous, closed: now, by, outcome: title } : { ...previous, due };
  } else {
    if (!["note","task"].includes(String(input.action)) || !title || (input.action === "task" && !validDay)) throw new HttpError(400, "יש להשלים את פרטי הטיפול");
    item = { id: crypto.randomUUID(), customer, title, kind: input.action === "note" ? "note" : "task", due: input.action === "note" ? now : due, by };
  }
  if (title.length > 2000) throw new HttpError(400, "הטקסט ארוך מדי");
  const result = await env.DB.prepare(`INSERT INTO console_records(kind,id,body,created_at,updated_at) VALUES ('crm-care',?,?,?,?)
    ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at
    WHERE json_extract(console_records.body,'$.closed') IS NULL AND json_extract(console_records.body,'$.customer')=json_extract(excluded.body,'$.customer')`)
    .bind(item.id, JSON.stringify(item), now, now).run();
  if (!result.meta.changes) throw new HttpError(409, "הטיפול כבר נסגר");
  return item;
}
