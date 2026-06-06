import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { User } from "@/generated/prisma/client";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function generateToken(
  userId: string,
  label: string,
  opts?: { expiresAt?: Date | null; scopes?: string }
) {
  const token = `qai_${randomBytes(32).toString("base64url")}`;
  const row = await prisma.apiToken.create({
    data: {
      userId,
      label,
      tokenHash: hashToken(token),
      expiresAt: opts?.expiresAt ?? null,
      scopes: opts?.scopes ?? "plans:write,feedback:read",
    },
  });
  return { id: row.id, token };
}

export interface VerifiedToken {
  user: User;
  scopes: string[];
}

export async function verifyToken(authorization: string | null): Promise<VerifiedToken | null> {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) return null;
  const row = await prisma.apiToken.findUnique({ where: { tokenHash: hashToken(match[1]) }, include: { user: true } });
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  await prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return { user: row.user, scopes: row.scopes.split(",").map((s) => s.trim()).filter(Boolean) };
}

export async function listTokens(userId: string) {
  return prisma.apiToken.findMany({
    where: { userId },
    select: { id: true, label: true, lastUsedAt: true, createdAt: true, expiresAt: true, scopes: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeToken(userId: string, id: string) {
  await prisma.apiToken.deleteMany({ where: { id, userId } });
}
