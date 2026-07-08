import { requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { registrationAllowlist } from "@/lib/registration";

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

export type AdminActionResult = { ok: true } | { error: "cannot_modify_self" | "cannot_modify_env_admin" };

export async function listUsers() {
  return prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, disabled: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Shared guard: never let an admin act on their own account or on an env break-glass admin. */
async function guardTarget(actorId: string, targetId: string, env: NodeJS.ProcessEnv): Promise<AdminActionResult | null> {
  if (actorId === targetId) return { error: "cannot_modify_self" };
  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { email: true } });
  if (target && adminEmails(env).includes(target.email.trim().toLowerCase())) return { error: "cannot_modify_env_admin" };
  return null;
}

export async function setRole(
  actorId: string,
  targetId: string,
  role: "member" | "admin",
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminActionResult> {
  const blocked = await guardTarget(actorId, targetId, env);
  if (blocked) return blocked;
  await prisma.user.update({ where: { id: targetId }, data: { role } });
  return { ok: true };
}

export async function setDisabled(
  actorId: string,
  targetId: string,
  disabled: boolean,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminActionResult> {
  const blocked = await guardTarget(actorId, targetId, env);
  if (blocked) return blocked;
  await prisma.user.update({ where: { id: targetId }, data: { disabled } });
  if (disabled) await prisma.session.deleteMany({ where: { userId: targetId } });
  return { ok: true };
}

/** Accept an exact email, a bare domain, or "*". Returns the normalized value or null. */
export function normalizeAllowlistValue(raw: string): string | null {
  const v = raw.trim().toLowerCase().replace(/^@/, "");
  if (v === "*") return "*";
  if (v.includes("@")) return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
  return /^[^@\s]+\.[^@\s]+$/.test(v) ? v : null; // bare domain
}

export async function listAllowlist(env: NodeJS.ProcessEnv = process.env) {
  const db = await prisma.registrationAllowlistEntry.findMany({
    select: { id: true, value: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return { env: registrationAllowlist(env), db };
}

export type AddAllowlistResult = { ok: true; id: string } | { error: "invalid" };

export async function addAllowlistEntry(actorId: string, rawValue: string): Promise<AddAllowlistResult> {
  const value = normalizeAllowlistValue(rawValue);
  if (!value) return { error: "invalid" };
  const row = await prisma.registrationAllowlistEntry.upsert({
    where: { value },
    create: { value, createdBy: actorId },
    update: {},
    select: { id: true },
  });
  return { ok: true, id: row.id };
}

export async function removeAllowlistEntry(id: string) {
  await prisma.registrationAllowlistEntry.deleteMany({ where: { id } });
}
