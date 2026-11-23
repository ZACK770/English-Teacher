export function qaCustomerSql(customerId: string): string {
  return `(EXISTS (SELECT 1 FROM customers qa WHERE qa.id=${customerId} AND lower(trim(qa.source))='qa-test')
    OR EXISTS (SELECT 1 FROM console_records qa WHERE qa.kind='customers' AND qa.id=${customerId}
      AND lower(trim(json_extract(qa.body,'$.source')))='qa-test'))`;
}

export async function qaCustomerIds(db: D1Database): Promise<Set<string>> {
  const rows = await Promise.all([
    db.prepare(`SELECT id FROM customers candidate WHERE ${qaCustomerSql("candidate.id")}`).all<{ id: string }>(),
    db.prepare(`SELECT id FROM console_records candidate WHERE kind='customers' AND ${qaCustomerSql("candidate.id")}`).all<{ id: string }>(),
  ]);
  return new Set(rows.flatMap(result => result.results.map(row => row.id)));
}

export async function isQaCustomer(db: D1Database, id: string): Promise<boolean> {
  return !!await db.prepare(`SELECT 1 WHERE ${qaCustomerSql("?1")}`).bind(id).first();
}

export async function isQaPhone(db: D1Database, phone: string): Promise<boolean> {
  return !!await db.prepare(`SELECT 1 FROM (SELECT id FROM (
    SELECT customer_id AS id,0 AS priority FROM customer_phones WHERE phone=?1
    UNION SELECT id,1 AS priority FROM customers WHERE primary_phone=?1
    UNION SELECT id,2 AS priority FROM console_records WHERE kind='customers' AND json_extract(body,'$.phone')=?1
    UNION SELECT json_extract(body,'$.customer_id') AS id,3 AS priority FROM console_records
      WHERE kind='learner-phone-links' AND json_extract(body,'$.phone')=?1
  ) ORDER BY priority,id LIMIT 1) candidate WHERE ${qaCustomerSql("candidate.id")}`).bind(phone).first();
}
