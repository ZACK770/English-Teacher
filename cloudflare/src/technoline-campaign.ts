import { randomHex } from "./env";

export function campaignExternalId(reference: string): string {
  return reference.slice(0, 17) + "-" + randomHex(16);
}
