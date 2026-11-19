export const FREE_DOMAINS = ["everyday", "property"];
export const isFreeDomain = (domain: string) => domain === "core" || FREE_DOMAINS.includes(domain);
export const isProDomain = (domain: string) => domain !== "recommended" && !isFreeDomain(domain);
export const isProLevel = (level: string) => !["beginner", "intermediate"].includes(level);
export const isProSelection = (domain: string, level: string) => isProDomain(domain) || isProLevel(level);

export function resolveFreeSelection<T extends string>(domain: string, level: T, paid: boolean): { domain: string; level: T | "intermediate" } {
  if (paid) return { domain, level };
  return { domain: domain === "recommended" || isFreeDomain(domain) ? domain : "everyday", level: isProLevel(level) ? "intermediate" : level };
}
