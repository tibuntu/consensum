/**
 * Self-service registration allowlist.
 *
 * Restricts who may create an account on a public instance. Enforced server-side
 * via a better-auth `databaseHooks.user.create.before` hook (see lib/auth.ts) — the
 * allowlist itself is never sent to the client.
 *
 * Fail-closed: when REGISTRATION_ALLOWLIST is unset or empty, NO self-service
 * registration is permitted. The operator must list at least their own email/domain
 * to bootstrap the first account, or set "*" to allow everyone (open registration).
 */

/**
 * Parse REGISTRATION_ALLOWLIST into normalized entries. Each entry is either an exact
 * email (`alice@corp.com`), a bare domain (`corp.com`), or `*` (allow all). Comma-separated;
 * trimmed, lowercased, a leading `@` stripped (so `@corp.com` is accepted as the domain
 * `corp.com`), and empties dropped.
 */
export function registrationAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.REGISTRATION_ALLOWLIST ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/**
 * Whether `email` is permitted to register. A `*` entry allows any (validly-formed) email
 * — the explicit opt-in to open registration. Otherwise an entry containing `@` must match
 * the full email exactly, and a bare-domain entry matches any address at exactly that domain
 * (subdomains are NOT implicitly matched). Returns false when the allowlist is empty
 * (fail-closed).
 */
export function isRegistrationAllowed(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const allowlist = registrationAllowlist(env);
  if (allowlist.length === 0) return false;

  const normalized = email.trim().toLowerCase();
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  if (!domain || normalized.indexOf("@") === -1) return false;

  if (allowlist.includes("*")) return true;
  return allowlist.some((entry) => (entry.includes("@") ? entry === normalized : entry === domain));
}
