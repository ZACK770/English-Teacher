import type { Env } from "./env";
import { manageKeva } from "./nedarim";

const str = (value: unknown) => (value == null ? "" : String(value)).trim();
const tail9 = (phone: string) => phone.replace(/\D/g, "").slice(-9);

export async function syncKevas(env: Env, force = false): Promise<number> {
  if (!env.NEDARIM_MOSAD_ID || !env.NEDARIM_API_KEY) return 0;
  if (!force) {
    const last = await env.DB.prepare("SELECT MAX(synced_at) AS at FROM nedarim_kevas").first<{ at: string | null }>();
    if (last?.at && Date.now() - Date.parse(last.at) < 55 * 60_000) return 0;
  }
  const now = new Date().toISOString();
  let lastId = "";
  let total = 0;
  for (let page = 0; page < 5; page++) {
    const fields: Record<string, string> = { Action: "GetKevaJson", MaxId: "2000" };
    if (lastId) fields.LastId = lastId;
    const rows = JSON.parse(await manageKeva(env, fields));
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) {
      const kevaId = str(row.KevaId);
      if (!kevaId) continue;
      const phone = str(row.Phone);
      const digits = tail9(phone);
      const match = digits.length === 9
        ? await env.DB.prepare(
          "SELECT customer_id AS id FROM customer_phones WHERE substr(replace(replace(phone,'-',''),'+',''),-9)=?1 UNION SELECT id FROM customers WHERE substr(replace(replace(primary_phone,'-',''),'+',''),-9)=?1 LIMIT 1",
        ).bind(digits).first<{ id: string }>()
        : null;
      await env.DB.prepare(
        `INSERT INTO nedarim_kevas (keva_id,name,phone,mail,amount,groupe,comments,enabled,itra,success,error_text,creation_date,next_date,customer_id,raw,synced_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
         ON CONFLICT(keva_id) DO UPDATE SET name=excluded.name,phone=excluded.phone,mail=excluded.mail,amount=excluded.amount,groupe=excluded.groupe,
         comments=excluded.comments,enabled=excluded.enabled,itra=excluded.itra,success=excluded.success,error_text=excluded.error_text,
         creation_date=excluded.creation_date,next_date=excluded.next_date,customer_id=excluded.customer_id,raw=excluded.raw,synced_at=excluded.synced_at`,
      ).bind(kevaId, str(row.ClientName), phone, str(row.Mail), str(row.Amount), str(row.Groupe), str(row.Comments), str(row.Enabled) === "1" ? 1 : 0,
        str(row.Itra), str(row.Success), str(row.ErrorText), str(row.CreationDate), str(row.NextDate), match?.id ?? null, JSON.stringify(row), now).run();
      lastId = kevaId;
      total++;
    }
    if (rows.length < 2000) break;
  }
  return total;
}

export async function listKevas(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT k.keva_id,k.name,k.phone,k.mail,k.amount,k.groupe,k.comments,k.enabled,k.itra,k.success,k.error_text,k.creation_date,k.next_date,k.customer_id,c.name AS customer_name,k.synced_at FROM nedarim_kevas k LEFT JOIN customers c ON c.id=k.customer_id ORDER BY k.creation_date DESC",
  ).all();
  return Response.json({ kevas: results });
}
