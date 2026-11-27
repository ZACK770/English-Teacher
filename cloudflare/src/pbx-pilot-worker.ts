import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./env";
export { default, CallSession } from "./pbx-pilot-entry";

export class SchoolVoiceSettings extends WorkerEntrypoint<Env> {
  async fetch(): Promise<Response> {
    const call = this.env.CALLS.get(this.env.CALLS.idFromName("extension-888"), { locationHint: "weur" });
    return call.fetch(new Request("https://internal.invalid/v1/internal/school-voice", {
      headers: { Authorization: "Bearer " + this.env.PBX_PILOT_ADMIN_TOKEN },
    }));
  }
}
