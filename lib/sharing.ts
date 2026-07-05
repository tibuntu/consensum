import { prisma } from "@/lib/db";
import type { DocumentRole, Visibility } from "@/lib/enums";
import { notifyShared } from "@/lib/notifications";
import { recomputeStateAndDispatch } from "@/lib/reviews";

export interface ParticipantRow {
  userId: string;
  name: string | null;
  email: string;
  role: "OWNER" | DocumentRole;
  isOwner: boolean;
}

/**
 * Owner + participants for a document, owner first and flagged isOwner:true.
 * createDocument also inserts a DocumentParticipant row for the owner (so
 * notifyParticipants/etc. can enumerate everyone with access via one table) —
 * that row is intentionally skipped here so the owner never appears twice.
 */
export async function listParticipants(documentId: string): Promise<ParticipantRow[]> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { ownerId: true, owner: { select: { name: true, email: true } } },
  });
  if (!doc) return [];

  const parts = await prisma.documentParticipant.findMany({
    where: { documentId },
    select: { userId: true, role: true, user: { select: { name: true, email: true } } },
  });

  const rows: ParticipantRow[] = [
    { userId: doc.ownerId, name: doc.owner.name, email: doc.owner.email, role: "OWNER", isOwner: true },
  ];
  for (const p of parts) {
    if (p.userId === doc.ownerId) continue;
    rows.push({ userId: p.userId, name: p.user.name, email: p.user.email, role: p.role as DocumentRole, isOwner: false });
  }
  return rows;
}

type ShareResult = { ok: true; userId: string } | { error: "no_account" | "cannot_share_owner" };

/**
 * Owner shares a document with an account by email. Idempotent: re-sharing an
 * existing participant just updates their role and does NOT re-notify — only a
 * newly-created row triggers notifyShared.
 *
 * Email matching: trimmed only, NOT lowercased. better-auth stores User.email
 * exactly as submitted at signup (no normalization hook in lib/auth.ts) and
 * User.email is a case-sensitive @unique column (no NOCASE collation in
 * prisma/schema.prisma) — lowercasing the lookup key here would silently miss
 * a real account whose email has any uppercase characters.
 */
export async function shareWith(
  ownerId: string,
  documentId: string,
  email: string,
  role: DocumentRole,
): Promise<ShareResult> {
  const target = await prisma.user.findUnique({ where: { email: email.trim() }, select: { id: true } });
  if (!target) return { error: "no_account" };
  if (target.id === ownerId) return { error: "cannot_share_owner" };

  const existing = await prisma.documentParticipant.findUnique({
    where: { documentId_userId: { documentId, userId: target.id } },
    select: { id: true },
  });
  await prisma.documentParticipant.upsert({
    where: { documentId_userId: { documentId, userId: target.id } },
    create: { documentId, userId: target.id, role },
    update: { role },
  });
  if (!existing) await notifyShared(documentId, target.id, ownerId).catch(() => {});
  return { ok: true, userId: target.id };
}

type SetRoleResult = { ok: true } | { error: "not_participant" };

/** Owner updates an existing participant's role. Target must already be a participant. */
export async function setRole(documentId: string, userId: string, role: DocumentRole): Promise<SetRoleResult> {
  const existing = await prisma.documentParticipant.findUnique({
    where: { documentId_userId: { documentId, userId } },
    select: { id: true },
  });
  if (!existing) return { error: "not_participant" };
  await prisma.documentParticipant.update({
    where: { documentId_userId: { documentId, userId } },
    data: { role },
  });
  return { ok: true };
}

type RemoveResult = { ok: true } | { error: "cannot_remove_owner" };

/**
 * Owner removes a participant: drops their DocumentParticipant row, dismisses
 * their Review votes on the document (so a since-removed reviewer's verdict no
 * longer counts), then recomputes + dispatches state — the removal can flip an
 * APPROVED doc back to OPEN if it was the deciding vote.
 */
export async function removeParticipant(actorId: string, documentId: string, userId: string): Promise<RemoveResult> {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { ownerId: true } });
  if (doc?.ownerId === userId) return { error: "cannot_remove_owner" };

  await prisma.$transaction([
    prisma.documentParticipant.deleteMany({ where: { documentId, userId } }),
    prisma.review.updateMany({ where: { documentId, reviewerId: userId }, data: { dismissed: true } }),
  ]);
  await recomputeStateAndDispatch(actorId, documentId);
  return { ok: true };
}

/** Owner sets the document's link-sharing visibility. Does not touch participant rows. */
export async function setVisibility(documentId: string, visibility: Visibility): Promise<void> {
  await prisma.document.update({ where: { id: documentId }, data: { visibility } });
}
