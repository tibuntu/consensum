import { requireUser } from "@/lib/api";

/** Parse ADMIN_EMAILS into normalized exact-email entries (trim, lowercase, drop empties). */
export function adminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

type AdminUser = { email: string; role?: string | null };

/**
 * Admin iff the email is in the env break-glass list OR the DB role is "admin".
 * Env admins are the recovery path and are treated as un-demotable elsewhere.
 */
export function isAdmin(user: AdminUser, env: NodeJS.ProcessEnv = process.env): boolean {
  if (user.role === "admin") return true;
  return adminEmails(env).includes(user.email.trim().toLowerCase());
}

/** Session user if the caller is an admin, else null (routes translate null → 404). */
export async function requireAdmin() {
  const user = await requireUser();
  if (!user || !isAdmin(user)) return null;
  return user;
}
