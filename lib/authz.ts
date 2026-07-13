import { prisma } from "@/lib/db";
import type { Visibility } from "@/lib/enums";

export type AccessRole = "OWNER" | "REVIEWER" | "VIEWER";

export interface Access {
  role: AccessRole;
  canView: boolean;
  canReview: boolean;
  canManage: boolean;
  visibility: Visibility;
  archived: boolean;
}

/**
 * Resolve a caller's access to a document into capabilities.
 *
 * Returns null when the caller has no access — the route translates that to 404
 * so a PRIVATE document never leaks its existence. In LINK mode a caller with no
 * participant row is auto-joined as REVIEWER (this is the successor to the old
 * ensureParticipant link-grant). In PRIVATE mode a caller with no row returns
 * null with no side effect.
 *
 * On an archived document canReview is forced false for everyone (owner
 * included); canView/canManage are unaffected — the owner needs canManage to
 * unarchive via the settings route.
 */
export async function resolveAccess(userId: string, documentId: string): Promise<Access | null> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { ownerId: true, visibility: true, archivedAt: true },
  });
  if (!doc) return null;
  const visibility = doc.visibility as Visibility;
  const archived = doc.archivedAt !== null;

  if (doc.ownerId === userId) {
    return { role: "OWNER", canView: true, canReview: !archived, canManage: true, visibility, archived };
  }

  const part = await prisma.documentParticipant.findUnique({
    where: { documentId_userId: { documentId, userId } },
    select: { role: true },
  });

  let role = part?.role as "REVIEWER" | "VIEWER" | undefined;
  if (!role) {
    if (visibility !== "LINK") return null; // PRIVATE + no row => no access
    await prisma.documentParticipant.upsert({
      where: { documentId_userId: { documentId, userId } },
      create: { documentId, userId, role: "REVIEWER" },
      update: {},
    });
    role = "REVIEWER";
  }

  return {
    role,
    canView: true,
    canReview: role === "REVIEWER" && !archived,
    canManage: false,
    visibility,
    archived,
  };
}

/** Resolve an annotation to its document id, or null when the annotation is missing. */
export async function documentIdForAnnotation(annotationId: string): Promise<string | null> {
  const ann = await prisma.annotation.findUnique({ where: { id: annotationId }, select: { documentId: true } });
  return ann?.documentId ?? null;
}
