const ref = (name: string) => ({ $ref: "#/components/schemas/" + name });
const ok = (schema: unknown, description = "OK") => ({ description, content: { "application/json": { schema } } });
const body = (schema: unknown) => ({ required: true, content: { "application/json": { schema } } });
const list = (name: string) => ({ type: "array", items: ref(name) });
const paging = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
  { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
];
const pathId = (name: string) => ({ name, in: "path", required: true, schema: { type: "string" } });
const app = { security: [{ appSession: [] }] };
const admin = { security: [{ adminBearer: [] }] };
const str = { type: "string" };
const strN = { type: ["string", "null"] };
const int = { type: "integer" };
const intN = { type: ["integer", "null"] };
const iso = { type: "string", format: "date-time" };
const isoN = { type: ["string", "null"], format: "date-time" };
const money = { type: "integer", description: "Amount in agorot (1 ILS = 100)" };

export const PLATFORM_OPENAPI = {
  openapi: "3.1.0",
  info: { title: "Kosher voice navigation platform API", version: "1.0.0",
    description: "Stable contract for the web platform and external AI clients. See docs/platform-data.md for data sources and rules." },
  components: {
    securitySchemes: {
      appSession: { type: "http", scheme: "bearer", description: "Customer session token from POST /v1/app/auth/verify" },
      adminBearer: { type: "http", scheme: "bearer", description: "Admin secret of the target environment (use staging for development)" },
    },
    schemas: {
      TripPath: { type: "object", properties: { trip_id: str, from_ms: int, to_ms: int, point_count: int, distance_m: int, max_speed_kmh: { type: "number" },
        avg_speed_kmh: { type: ["number", "null"] }, points: { type: "array", items: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 } } } },
      Settings: { type: "object", properties: { navigation_voice: { type: ["string", "null"], enum: ["engine", "gemini", null] },
        voice: { type: ["string", "null"], description: "Charon, Puck, Fenrir, Aoede, Kore …" }, navigation_interrupt: { type: ["string", "null"], enum: ["speech", "stop_word", null] } } },
      Error: { type: "object", properties: { detail: str } },
      Customer: { type: "object", properties: { id: str, name: str, primary_phone: strN, status: { enum: ["lead", "active", "suspended", "closed"] }, device_mode: { enum: ["none", "kit", "own"] },
        source: str, city: str, notes: str, created_at: iso, updated_at: iso } },
      CustomerInput: { type: "object", required: ["name", "phone"], properties: { name: str, phone: str, status: { enum: ["lead", "active", "suspended", "closed"] }, device_mode: { enum: ["none", "kit", "own"] },
        city: str, source: str, notes: str } },
      Plan: { type: "object", properties: { id: str, name: str, product: { enum: ["navigation", "school", "translator"] },
        billing: { enum: ["prepaid", "monthly", "yearly", "one_time"] }, price_agorot: money, included_minutes: intN, validity_days: intN,
        includes_device: { type: "boolean" }, active: { type: "boolean" }, description: str } },
      PlanInput: { type: "object", required: ["name", "billing", "price_agorot"], properties: { name: str, billing: { enum: ["prepaid", "monthly", "yearly", "one_time"] },
        price_agorot: money, included_minutes: intN, validity_days: intN, includes_device: { type: "boolean" }, active: { type: "boolean" }, description: str } },
      Subscription: { type: "object", properties: { id: str, customer_id: str, plan_id: str, plan_name: str, product: str,
        status: { enum: ["trial", "active", "past_due", "cancelled", "expired"] }, price_agorot: money, started_at: iso, current_period_end: isoN, cancelled_at: isoN } },
      SubscriptionInput: { type: "object", required: ["customer_id", "plan_id", "status"], properties: { customer_id: str, plan_id: str,
        status: { enum: ["trial", "active", "past_due", "cancelled", "expired"] }, price_agorot: money, started_at: iso, current_period_end: isoN, notes: str } },
      Sim: { type: "object", required: ["iccid"], properties: { iccid: str, carrier: str, msisdn: str, plan_name: str, data_mb_month: intN,
        monthly_cost_agorot: intN, status: { enum: ["stock", "active", "suspended", "cancelled"] }, activated_at: isoN, notes: str } },
      Device: { type: "object", properties: { device_id: str, label: str, model: str, imei: str, sim_iccid: strN,
        inventory_status: { enum: ["stock", "in_service", "returned", "faulty", "retired"] }, sold_at: isoN, notes: str, customer_id: strN,
        last_received_at_ms: intN, battery_level_pct: { ...intN, description: "Device-estimated percentage; not a precise measurement" } } },
      DevicePatch: { type: "object", properties: { model: str, imei: str, sim_iccid: strN, inventory_status: { enum: ["stock", "in_service", "returned", "faulty", "retired"] },
        sold_at: isoN, notes: str } },
      LivePosition: { type: "object", description: "Latest tracker report. position is null when the last fix is older than 120 s or invalid.",
        properties: { device_id: str, fresh: { type: "boolean" }, last_received_at_ms: intN, last_valid_fix_at_ms: intN,
          battery: { type: "object" }, position: { type: ["object", "null"], properties: { latitude: { type: "number" }, longitude: { type: "number" },
            speed_mps: { type: "number" }, heading: { type: ["number", "null"] }, fix_at_ms: int } } } },
      Cost: { type: ["object", "null"], description: "Calculated from provider-reported usage and published prices; not an invoice",
        properties: { status: { enum: ["complete_ai", "partial"] }, known_subtotal_ils: { type: ["number", "null"] }, known_subtotal_usd: { type: ["number", "null"] }, basis: str } },
      Trip: { type: "object", properties: { id: str, device_id: str, destination_label: str, destination_address: str,
        status: { enum: ["active", "completed", "cancelled"] }, eta_at_ms: intN, created_at_ms: int, ended_at_ms: intN, duration_s: intN, last_call_id: strN, last_call_cost: ref("Cost") } },
      Call: { type: "object", properties: { call_id: str, bot_id: str, channel: str, created_at: iso, duration_seconds: intN, summary_he: strN, cost: ref("Cost") } },
      Turn: { type: "object", properties: { created_at: iso, direction: str, text: str } },
      Destination: { type: "object", required: ["label", "address"], properties: { id: str, label: str, address: str, updated_at: iso } },
      Invoice: { type: "object", properties: { id: str, customer_id: str, subscription_id: strN, description: str, amount_agorot: money, vat_rate: { type: "number" },
        status: { enum: ["open", "paid", "void", "refunded"] }, provider: { enum: ["manual", "nedarim"] }, provider_reference: strN, issued_at: iso, paid_at: isoN } },
      InvoiceInput: { type: "object", required: ["customer_id", "description", "amount_agorot"], properties: { customer_id: str, subscription_id: strN, description: str,
        amount_agorot: money, vat_rate: { type: "number", default: 0.18 }, status: { enum: ["open", "paid", "void", "refunded"] }, provider_reference: strN, issued_at: iso, paid_at: isoN } },
    },
  },
  paths: {
    "/v1/app/plans": { get: { summary: "Active plans (public)", responses: { 200: ok(list("Plan")) } } },
    "/v1/app/auth/verify": { post: { summary: "Exchange phone + 6-digit login code for a 30-day session token", requestBody: body({ type: "object", required: ["phone", "code"],
      properties: { phone: str, code: { type: "string", pattern: "^[0-9]{6}$" } } }), responses: { 200: ok({ type: "object", properties: { token: str, customer_id: str, expires_at_ms: int } }), 401: ok(ref("Error"), "Wrong or expired code") } } },
    "/v1/app/auth/logout": { post: { ...app, summary: "Revoke the current session", responses: { 200: ok({ type: "object" }) } } },
    "/v1/app/me": { get: { ...app, summary: "Customer profile, subscriptions and assigned device", responses: { 200: ok({ type: "object", properties: {
      customer: ref("Customer"), phones: { type: "array", items: str }, subscriptions: list("Subscription"), device: { type: ["object", "null"] } } }) } } },
    "/v1/app/device/live": { get: { ...app, summary: "Live tracker position; poll every 2-5 s", responses: { 200: ok(ref("LivePosition")), 404: ok(ref("Error"), "No device assigned") } } },
    "/v1/app/trips": { get: { ...app, summary: "Trip history, newest first", parameters: paging, responses: { 200: ok(list("Trip")) } } },
    "/v1/app/signup": { post: { summary: "Public registration form; creates a lead (optionally with a trial subscription). No login, no payment.", security: [],
      requestBody: body({ type: "object", required: ["name", "phone", "device_mode"], properties: { name: str, phone: str, city: str, plan_id: strN, notes: str,
        device_mode: { type: "string", enum: ["none", "kit", "own"], description: "none=no tracker yet, kit=buy our configured kit, own=customer's own approved tracker" } } }),
      responses: { 201: ok({ type: "object", properties: { customer_id: str, status: str } }), 409: { description: "Phone already registered" }, 429: { description: "Too many signups" } } } },
    "/v1/app/trips/{id}/path": { get: { ...app, summary: "Driven path (lat, lng, fix_at_ms, speed_kmh) with distance and speed metrics; history kept 90 days", parameters: [pathId("id")], responses: { 200: ok(ref("TripPath")) } } },
    "/v1/app/settings": { get: { ...app, summary: "Per-customer call settings; null means the system default", responses: { 200: ok(ref("Settings")) } },
      put: { ...app, summary: "Partial update of call settings (applies from the next call)", requestBody: body(ref("Settings")), responses: { 200: ok(ref("Settings")) } } },
    "/v1/app/calls": { get: { ...app, summary: "Call history with calculated cost", parameters: paging, responses: { 200: ok(list("Call")) } } },
    "/v1/app/calls/{call_id}/turns": { get: { ...app, summary: "Transcript of one of the customer's calls", parameters: [pathId("call_id")], responses: { 200: ok(list("Turn")) } } },
    "/v1/app/invoices": { get: { ...app, summary: "Invoices and receipts", responses: { 200: ok(list("Invoice")) } } },
    "/v1/app/destinations": { get: { ...app, summary: "Saved destinations", responses: { 200: ok(list("Destination")) } },
      post: { ...app, summary: "Save a destination", requestBody: body(ref("Destination")), responses: { 201: ok(ref("Destination")) } } },
    "/v1/app/destinations/{id}": { delete: { ...app, parameters: [pathId("id")], responses: { 200: ok({ type: "object" }) } } },
    "/v1/admin/app/summary": { get: { ...admin, summary: "Counts for dashboards", responses: { 200: ok({ type: "object" }) } } },
    "/v1/admin/app/customers": { get: { ...admin, parameters: [...paging, { name: "q", in: "query", schema: str }], responses: { 200: ok(list("Customer")) } },
      post: { ...admin, requestBody: body(ref("CustomerInput")), responses: { 201: ok(ref("Customer")) } } },
    "/v1/admin/app/customers/{id}": { get: { ...admin, summary: "Customer with subscriptions, device, invoices, trips and calls", parameters: [pathId("id")], responses: { 200: ok({ type: "object" }) } },
      patch: { ...admin, parameters: [pathId("id")], requestBody: body(ref("CustomerInput")), responses: { 200: ok(ref("Customer")) } } },
    "/v1/admin/app/customers/{id}/settings": { get: { ...admin, parameters: [pathId("id")], responses: { 200: ok(ref("Settings")) } },
      put: { ...admin, parameters: [pathId("id")], requestBody: body(ref("Settings")), responses: { 200: ok(ref("Settings")) } } },
    "/v1/admin/app/trips": { get: { ...admin, summary: "All trips, newest first", parameters: [...paging, { name: "customer_id", in: "query", schema: str }], responses: { 200: ok(list("Trip")) } } },
    "/v1/admin/app/trips/{id}/path": { get: { ...admin, parameters: [pathId("id")], responses: { 200: ok(ref("TripPath")) } } },
    "/v1/admin/app/reports": { get: { ...admin, summary: "Customers by status/device mode, MRR, and monthly customers/trips/call cost", responses: { 200: ok({ type: "object" }) } } },
    "/v1/admin/app/customers/{id}/login-code": { post: { ...admin, summary: "Issue a 6-digit login code valid for 10 minutes (read it to the customer)", parameters: [pathId("id")],
      responses: { 201: ok({ type: "object", properties: { code: str, expires_at_ms: int } }) } } },
    "/v1/admin/app/plans": { get: { ...admin, responses: { 200: ok(list("Plan")) } },
      post: { ...admin, summary: "Create a navigation plan", requestBody: body(ref("PlanInput")), responses: { 201: ok(ref("Plan")) } } },
    "/v1/admin/app/plans/{id}": { patch: { ...admin, summary: "Update a navigation plan", parameters: [pathId("id")], requestBody: body(ref("PlanInput")), responses: { 200: ok(ref("Plan")) } } },
    "/v1/admin/app/subscriptions": { get: { ...admin, parameters: [{ name: "customer_id", in: "query", schema: str }], responses: { 200: ok(list("Subscription")) } },
      post: { ...admin, requestBody: body(ref("SubscriptionInput")), responses: { 201: ok(ref("Subscription")) } } },
    "/v1/admin/app/subscriptions/{id}": { patch: { ...admin, parameters: [pathId("id")], requestBody: body({ type: "object", properties: {
      status: str, current_period_end: isoN, cancelled_at: isoN, notes: str } }), responses: { 200: ok(ref("Subscription")) } } },
    "/v1/admin/app/sims": { get: { ...admin, responses: { 200: ok(list("Sim")) } }, post: { ...admin, summary: "Create or update by ICCID", requestBody: body(ref("Sim")), responses: { 200: ok(ref("Sim")) } } },
    "/v1/admin/app/devices": { get: { ...admin, responses: { 200: ok(list("Device")) } } },
    "/v1/admin/app/devices/{id}": { patch: { ...admin, summary: "Inventory fields only; tracker identity is managed under /v1/admin/navigation/devices", parameters: [pathId("id")],
      requestBody: body(ref("DevicePatch")), responses: { 200: ok(ref("Device")) } } },
    "/v1/admin/app/invoices": { get: { ...admin, parameters: [{ name: "customer_id", in: "query", schema: str }], responses: { 200: ok(list("Invoice")) } },
      post: { ...admin, summary: "Record a manual invoice (no payment is charged)", requestBody: body(ref("InvoiceInput")), responses: { 201: ok(ref("Invoice")) } } },
    "/v1/admin/app/invoices/{id}": { patch: { ...admin, summary: "Update a manual invoice", parameters: [pathId("id")], requestBody: body({ type: "object", properties: {
      status: str, paid_at: isoN, provider_reference: strN } }), responses: { 200: ok(ref("Invoice")) } } },
  },
} as const;
