import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { DocumentSource } from "@/lib/enums";

export async function createDocument(
  userId: string,
  title: string,
  markdown: string,
  opts?: { source?: DocumentSource; agentContext?: string; requiredApprovals?: number; requireBlockerResolution?: boolean; idempotencyKey?: string }
) {
  const source = opts?.source ?? "WEB";
  const doc = await prisma.document.create({
    data: {
      title,
      ownerId: userId,
      state: "OPEN",
      source,
      visibility: source === "CLAUDE_CODE" ? "LINK" : "PRIVATE",
      agentContext: opts?.agentContext ?? null,
      idempotencyKey: opts?.idempotencyKey ?? null,
      requiredApprovals: opts?.requiredApprovals ?? 1,
      requireBlockerResolution: opts?.requireBlockerResolution ?? false,
    },
  });
  const version = await prisma.documentVersion.create({
    data: {
      documentId: doc.id,
      versionNumber: 1,
      markdown,
      contentHash: createHash("sha256").update(markdown).digest("hex"),
      createdById: userId,
    },
  });
  await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
  await prisma.documentParticipant.create({ data: { documentId: doc.id, userId } });
  return doc.id;
}

/** Idempotent-create support: find an owner's plan previously created with
 *  the same client idempotency key, if any. */
export async function findPlanByIdempotencyKey(ownerId: string, idempotencyKey: string) {
  return prisma.document.findFirst({ where: { ownerId, idempotencyKey }, select: { id: true } });
}

/** Hard-delete a document and all dependents. Ordered to satisfy the
 *  onDelete: Restrict FKs on DocumentVersion (Annotation.created/appliedInVersion,
 *  Review.onVersion): remove reviews + annotations (comments cascade) first, then
 *  the document (versions, participants, notifications cascade). Single transaction. */
export async function deleteDocument(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.review.deleteMany({ where: { documentId: id } }),
    prisma.annotation.deleteMany({ where: { documentId: id } }),
    prisma.document.delete({ where: { id } }),
  ]);
}

/** Where-fragment for "documents this user can see" — a participant row = access. */
export const visibleToUser = (userId: string) => ({ participants: { some: { userId } } });

export async function listDocuments(userId: string, opts?: { includeArchived?: boolean }) {
  return prisma.document.findMany({
    where: {
      ...visibleToUser(userId),
      ...(opts?.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: { updatedAt: "desc" },
    include: {
      owner: { select: { name: true, email: true } },
      tags: { select: { tag: { select: { name: true } } }, orderBy: { tag: { name: "asc" } } },
    },
  });
}

/** Archive (hide + read-only) or unarchive a document. The settings route owns
 *  the canManage gate, mirroring setVisibility. Note: the update bumps
 *  @updatedAt, so unarchiving deliberately surfaces the doc atop the list. */
export async function setArchived(id: string, archived: boolean): Promise<void> {
  await prisma.document.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
}

const DECISIVE = ["APPROVE", "REQUEST_CHANGES"];
const QUEUE_SELECT = {
  id: true,
  title: true,
  state: true,
  updatedAt: true,
  owner: { select: { name: true, email: true } },
} as const;

/**
 * The caller's review queue, split into two tiers and excluding docs they own:
 * - blocking: they're a required reviewer on a non-CLOSED doc with no decisive
 *   verdict (their approval is what's holding it back).
 * - openReviews: they're a non-required reviewer on an OPEN/CHANGES_REQUESTED doc
 *   with no decisive verdict.
 * "Decisive" = a non-dismissed APPROVE or REQUEST_CHANGES by the caller ON THE
 * CURRENT VERSION (M12a): a verdict left on a superseded version no longer keeps
 * the doc out of the queue — the reviewer is re-surfaced with `reReview: true`.
 * `onVersion.currentFor` is non-null exactly when the reviewed version is still
 * the document's current one.
 */
export async function listReviewQueue(userId: string) {
  const myDecisive = { reviewerId: userId, dismissed: false, verdict: { in: DECISIVE } };
  const noCurrentDecisiveVerdict = {
    reviews: { none: { ...myDecisive, onVersion: { currentFor: { isNot: null } } } },
  };
  // Any remaining non-dismissed decisive verdict on a queued doc is necessarily
  // stale (a current-version one would have excluded the doc above) — surface
  // it as the re-review hint.
  const select = { ...QUEUE_SELECT, reviews: { where: myDecisive, select: { id: true } } };
  const [blocking, openReviews] = await Promise.all([
    prisma.document.findMany({
      where: {
        ownerId: { not: userId },
        state: { not: "CLOSED" },
        archivedAt: null,
        participants: { some: { userId, required: true } },
        ...noCurrentDecisiveVerdict,
      },
      orderBy: { updatedAt: "desc" },
      select,
    }),
    prisma.document.findMany({
      where: {
        ownerId: { not: userId },
        state: { in: ["OPEN", "CHANGES_REQUESTED"] },
        archivedAt: null,
        participants: { some: { userId, role: "REVIEWER", required: false } },
        ...noCurrentDecisiveVerdict,
      },
      orderBy: { updatedAt: "desc" },
      select,
    }),
  ]);
  const withHint = <T extends { reviews: { id: string }[] }>(rows: T[]) =>
    rows.map(({ reviews, ...rest }) => ({ ...rest, reReview: reviews.length > 0 }));
  return { blocking: withHint(blocking), openReviews: withHint(openReviews) };
}

export async function getDocumentDetail(id: string) {
  const doc = await prisma.document.findUnique({
    where: { id },
    include: {
      currentVersion: true,
      owner: { select: { name: true, email: true } },
      tags: { select: { tag: { select: { name: true } } }, orderBy: { tag: { name: "asc" } } },
      versions: {
        orderBy: { versionNumber: "asc" },
        select: { versionNumber: true, createdAt: true, createdBy: { select: { name: true, email: true } } },
      },
      annotations: {
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { name: true, email: true } },
          comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true, email: true } } } },
          createdOnVersion: { select: { versionNumber: true } },
          appliedInVersion: { select: { versionNumber: true } },
        },
      },
      reviews: { include: { reviewer: { select: { name: true, email: true } }, onVersion: { select: { versionNumber: true } } } },
      implementationLinks: { orderBy: { createdAt: "asc" } },
    },
  });
  return doc;
}
