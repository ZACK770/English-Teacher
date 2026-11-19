import { z } from "zod";
import { HttpError, type Env } from "./env";
import { CheckoutStore } from "./checkout";
import { BusinessStore } from "./business";
import { DomainSchema, SubscriptionStore } from "./subscriptions";

export async function subscriptionApi(request: Request, store: SubscriptionStore, segments: string[], customerId?: string, env?: Env): Promise<Response> {
  const [id, action, memberId] = segments;
  const method = request.method;
  try {
    if (!id && method === "GET") {
      const owner = customerId || new URL(request.url).searchParams.get("customer_id");
      return Response.json({ items: owner ? await store.summary(owner) : await store.list() });
    }
    if (!id && method === "POST" && !customerId) {
      const input = z.object({ customer_id: z.string().min(1), plan_id: z.string().min(1), domains: z.array(DomainSchema).optional() }).parse(await request.json());
      return Response.json(await store.create(input.customer_id, input.plan_id, undefined, input.domains), { status: 201 });
    }
    if (!id) throw new HttpError(404, "Not found");
    const sub = await store.get(id);
    if (customerId && sub.customer_id !== customerId) throw new HttpError(403, "Only the subscription owner can manage it");
    if (!action && method === "GET" && !customerId) return Response.json({ ...sub, renewal_amount_agorot: await store.renewalAmount(id), members: (await store.db.prepare("SELECT * FROM subscription_members WHERE subscription_id=?").bind(id).all()).results });
    if (action === "members" && method === "DELETE" && memberId && !customerId) {
      await store.removeMember(id, memberId);
      return Response.json({ removed: true });
    }
    if (method !== "POST") throw new HttpError(404, "Not found");
    const at = new Date().toISOString();
    if (action === "pause") {
      const input = z.object({ days: z.number().int().min(1).max(60) }).parse(await request.json());
      return Response.json(await store.pause(id, input.days, at));
    }
    if (action === "resume") return Response.json(await store.resume(id, at));
    if (action === "cancel") {
      const standing = await store.db.prepare("SELECT id FROM standing_orders WHERE entitlement_id=?").bind(id).first<{ id: string }>();
      if (standing) {
        if (!env) throw new HttpError(503, "Billing service required");
        await new CheckoutStore(new BusinessStore(store.db)).cancel(env, standing.id, sub.customer_id);
      } else await store.cancel(id, at);
      return Response.json(await store.get(id));
    }
    if (customerId) throw new HttpError(403, "Admin action required");
    if (action === "evaluate-guarantee") return Response.json(await store.evaluateGuarantee(id, at));
    if (action === "renewal") {
      const input = z.object({ reference: z.string().min(1).max(150) }).parse(await request.json());
      return Response.json(await store.recordRenewal(id, at, input.reference));
    }
    if (action === "members") {
      const input = z.object({ phone: z.string().min(5).max(40), name: z.string().trim().min(1).max(100) }).parse(await request.json());
      return Response.json(await store.addMember(id, input.phone, input.name), { status: 201 });
    }
    throw new HttpError(404, "Not found");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof z.ZodError || error instanceof SyntaxError) throw new HttpError(422, "Invalid subscription input");
    throw new HttpError(409, error instanceof Error ? error.message : "Subscription action failed");
  }
}
