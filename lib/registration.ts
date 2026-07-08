import { prisma } from "@/lib/db";

export function registrationAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.REGISTRATION_ALLOWLIST ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/**
 * Pure allowlist match over a set of entries (exact email, bare domain, or "*").
 * Fail-closed on an empty set. Malformed emails never match, even with "*".
 */
export function matchesAllowlist(email: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false;
  const normalized = email.trim().toLowerCase();
  const at = normalized.indexOf("@");
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  if (at === -1 || !domain) return false;
  if (allowlist.includes("*")) return true;
  return allowlist.some((entry) => (entry.includes("@") ? entry === normalized : entry === domain));
}

/** Values of every DB allowlist entry (already stored normalized/lowercased). */
async function dbAllowlistValues(): Promise<string[]> {
  const rows = await prisma.registrationAllowlistEntry.findMany({ select: { value: true } });
  return rows.map((r) => r.value);
}

/**
 * Whether `email` may register: allowed if the env allowlist OR a DB entry matches.
 * Async because it reads the DB. Empty env + empty table stays fail-closed.
 */
export async function isRegistrationAllowed(email: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const entries = registrationAllowlist(env).concat(await dbAllowlistValues());
  return matchesAllowlist(email, entries);
}
