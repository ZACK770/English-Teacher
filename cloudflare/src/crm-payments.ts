import { type Env, HttpError } from "./env";

export async function crmPayments(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== "/v1/admin/crm/payments") return null;
  if (request.method !== "GET") throw new HttpError(405, "פעולה לא נתמכת");
  const query = new URL(request.url).searchParams;
  const recurring = query.get("kind") === "standing";
  const customer = query.get("customer") || null;
  const id = query.get("id") || null;
  const offset = Math.floor(Math.max(0, Math.min(100000, Number(query.get("offset")) || 0)));
  const sql = recurring ? `
    SELECT s.id,s.customer_id,COALESCE(json_extract(cr.body,'$.name'),c.name) AS customer_name,COALESCE(json_extract(cr.body,'$.phone'),c.primary_phone) AS phone,s.created_at,s.state,
      s.monthly_agorot/100.0 AS amount_ils,s.next_date,s.last_charge_at,s.entitlement_id AS subscription_id,
      s.first_order_id,s.last_refusal_at,p.receipt_id,p.state AS first_order_state
    FROM standing_orders s LEFT JOIN customers c ON c.id=s.customer_id
    LEFT JOIN console_records cr ON cr.kind='customers' AND cr.id=s.customer_id
    LEFT JOIN payment_orders p ON p.id=s.first_order_id
    WHERE (? IS NULL OR s.customer_id=?) AND (? IS NULL OR s.id=?)
    ORDER BY s.created_at DESC,s.id LIMIT 101 OFFSET ?
  ` : `
    SELECT r.id,r.customer_id,COALESCE(json_extract(cr.body,'$.name'),c.name) AS customer_name,COALESCE(json_extract(cr.body,'$.phone'),c.primary_phone) AS phone,r.created_at,r.amount_ils,r.reference,
      r.package_id,r.subscription_id,r.payment_reversed_at,
      CASE WHEN r.payment_reversed_at IS NOT NULL THEN 'reversed'
        WHEN EXISTS(SELECT 1 FROM payment_orders p WHERE p.receipt_id=r.id AND p.state='paid'
          AND trim(COALESCE(p.transaction_id,''))<>'') OR EXISTS(SELECT 1 FROM subscription_renewals n
          WHERE n.subscription_id=r.subscription_id AND r.reference='subscription:'||n.subscription_id||':'||n.period_start
          AND n.reference GLOB 'nedarim-keva:*:*') THEN 'verified' ELSE 'recorded' END AS state
    FROM sales_receipts r LEFT JOIN customers c ON c.id=r.customer_id
    LEFT JOIN console_records cr ON cr.kind='customers' AND cr.id=r.customer_id
    WHERE (? IS NULL OR r.customer_id=?) AND (? IS NULL OR r.id=?)
    ORDER BY r.created_at DESC,r.id LIMIT 101 OFFSET ?
  `;
  const { results } = await env.DB.prepare(sql).bind(customer,customer,id,id,offset).all();
  return Response.json({ items: results.slice(0,100), more: results.length>100 }, { headers: { "Cache-Control": "no-store" } });
}
