import { BusinessStore } from "./business";
import { type Env, HttpError, extensionPath, nowIso, randomHex } from "./env";
import { visiblePhone } from "./phone";
import { subscriptionApi } from "./subscription-api";
import { SubscriptionStore } from "./subscriptions";
import type { IVRResponse } from "./pbx";

const CONFIRM = "לאישור ביטול המנוי הקישו 1, לחזרה הקישו 0";
const SUCCESS = "ביטול המנוי הושלם. לא יתבצעו חיובים נוספים. הגישה לתקופה שכבר שולמה תישמר. לחזרה לשירות לקוחות הקישו 0.";
const prompt = (text: string, keys = "0,1"): IVRResponse => ({
  type: "simpleMenu", name: "isaacCancelSubscription", enabledKeys: keys, times: 2, timeout: 10,
  errorReturn: "ERROR", post: true, files: [{ text }],
});
type Cancellation = { customer_id: string; phone: string; ids: string[]; completed: string[]; state: "pending" | "done" | "empty" | "back"; description: string };

export async function subscriptionCancellationResponse(
  b: BusinessStore, env: Env, base: string, params: Record<string, string>, customerId: string,
): Promise<IVRResponse> {
  const clock = Date.now();
  const callId = params.PBXcallId;
  if (!callId || callId.length > 200) throw new HttpError(400, "Invalid cancellation call");
  const key = "subscription-cancel:" + callId;
  const choice = params.isaacCancelSubscription;
  const back = (): IVRResponse => ({
    type: "goTo", goTo: extensionPath(base, "/3"),
    removeParams: ["isaacSalesService", "isaacCancelSubscription"],
  });
  const respond = async (): Promise<IVRResponse> => {
    if (params.PBXcallStatus === "HANGUP") return { type: "hangup" };
    const phone = visiblePhone(params.PBXphone ?? "");
    if (!phone || await b.customerForPhone(phone) !== customerId) {
      return choice === "0" || choice === "ERROR" ? back() : prompt("לא נמצא מנוי פעיל על שם המתקשר. לחזרה לשירות לקוחות הקישו 0.", "0");
    }
    let saved = await b.loadContext(key) as Partial<Cancellation>;
    if (choice === "0" || choice === "ERROR") {
      await b.saveContext(key, { state: "back" });
      return back();
    }
    if (saved.customer_id !== customerId || saved.phone !== phone || !["pending", "done", "empty"].includes(saved.state ?? "")) {
      const { results } = await b.db.prepare(`SELECT s.id,p.name FROM subscriptions s JOIN plans p ON p.id=s.plan_id
        WHERE s.customer_id=? AND p.product='school' AND s.status IN ('active','paused','past_due') ORDER BY s.created_at,s.id`)
        .bind(customerId).all<{ id: string; name: string }>();
      const description = results.map(s => `מנוי ${s.name.slice(0, 100)}`).join(". ");
      saved = { customer_id: customerId, phone, ids: results.map(s => s.id), completed: [], state: results.length ? "pending" : "empty", description };
      await b.saveContext(key, saved);
      return results.length
        ? prompt("הביטול יחול על כל המנויים הבאים: " + description + ". חיובים עתידיים יופסקו והגישה לתקופה שכבר שולמה תישמר. " + CONFIRM)
        : prompt("לא נמצא מנוי פעיל על שם המתקשר. לחזרה לשירות לקוחות הקישו 0.", "0");
    }
    if (saved.state === "done") return prompt(SUCCESS, "0");
    if (saved.state === "empty") return prompt("לא נמצא מנוי פעיל על שם המתקשר. לחזרה לשירות לקוחות הקישו 0.", "0");
    if (choice !== "1") return prompt("הביטול יחול על כל המנויים הבאים: " + saved.description + ". " + CONFIRM);
    const completed = saved.completed ?? [];
    const store = new SubscriptionStore(b.db, env);
    for (const id of saved.ids ?? []) {
      if (completed.includes(id)) continue;
      try {
        const result = await subscriptionApi(new Request("https://internal/subscriptions/cancel", { method: "POST" }), store, [id, "cancel"], customerId, env);
        if (!result.ok) throw new Error("Cancellation not confirmed");
        completed.push(id);
        await b.saveContext(key, { completed });
        await b.audit("subscription:phone_cancelled", id);
      } catch {
        return prompt("לא הצלחנו להשלים את ביטול כל המנויים. לא התקבל אישור סופי להפסקת כל החיובים. לניסיון נוסף הקישו 1. לחזרה לשירות לקוחות הקישו 0.");
      }
    }
    await b.saveContext(key, { state: "done", completed });
    return prompt(SUCCESS, "0");
  };
  const result = await respond();
  await b.save("ivr-events", {
    call_id: callId, customer_id: customerId, route: "subscription-cancel",
    input: choice === undefined ? {} : { isaacCancelSubscription: choice.slice(0, 200) },
    output: result, finished: params.PBXcallStatus === "HANGUP", latency_ms: Date.now() - clock, at: nowIso(),
  }, randomHex(16));
  return result;
}
