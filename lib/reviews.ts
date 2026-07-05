import { prisma } from "@/lib/db";
import { computeDocumentState } from "@/lib/review-state";
import type { ReviewVerdict } from "@/lib/enums";
import { publish } from "@/lib/events";
import { notifyParticipants } from "@/lib/notifications";
import { dispatch } from "@/lib/webhooks";

/** Open must-resolve blockers: BLOCKER-severity threads still OPEN, any anchor
 *  state — the exact definition of the feedback payload's rollup.mustResolve. */
async function countOpenBlockers(documentId: string): Promise<number> {
  return prisma.annotation.count({ where: { documentId, severity: "BLOCKER", threadStatus: "OPEN" } });
}

/**
 * Recompute the document's state from its current reviews + requiredApprovals
 * (and, when the document opted in, the blocker gate), persist it, and publish
 * the SSE state change. Returns prev + new state so the caller can decide
 * whether to dispatch decision.changed. Shared by submitReview,
 * updateReviewSettings, and recomputeStateForBlockerGate.
 */
async function recomputeState(documentId: string): Promise<{ state: string; prevState: string }> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { requiredApprovals: true, requireBlockerResolution: true, state: true },
  });
  if (!doc) throw new Error("document not found");
  const prevState = doc.state;
  const reviews = await prisma.review.findMany({ where: { documentId } });
  const requiredParts = await prisma.documentParticipant.findMany({
    where: { documentId, required: true },
    select: { userId: true },
  });
  const requiredReviewerIds = requiredParts.map((p) => p.userId);
  const gate = doc.requireBlockerResolution
    ? { requireBlockerResolution: true, openBlockers: await countOpenBlockers(documentId) }
    : undefined;
  const state = computeDocumentState(
    reviews.map((r) => ({ verdict: r.verdict as ReviewVerdict, dismissed: r.dismissed, reviewerId: r.reviewerId })),
    doc.requiredApprovals,
    gate,
    requiredReviewerIds,
  );
  await prisma.document.update({ where: { id: documentId }, data: { state } });
  publish(documentId, { type: "review.updated", state });
  return { state, prevState };
}

export async function submitReview(userId: string, documentId: string, verdict: ReviewVerdict) {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { currentVersionId: true } });
  if (!doc?.currentVersionId) throw new Error("document has no current version");

  // One active verdict per reviewer for the current version: replace any prior.
  await prisma.review.deleteMany({ where: { documentId, reviewerId: userId } });
  await prisma.review.create({ data: { documentId, reviewerId: userId, verdict, onVersionId: doc.currentVersionId } });

  const { state, prevState } = await recomputeState(documentId);
  await notifyParticipants(documentId, userId, "review").catch(() => {});
  await dispatch(documentId, "review.updated", { decision: state.toLowerCase() }, userId).catch(() => {});
  if (state !== prevState) {
    await dispatch(documentId, "decision.changed", { decision: state.toLowerCase() }, userId).catch(() => {});
  }
  return state;
}

/**
 * Owner updates review settings in one shot. Single document.update with the
 * merged fields, single recompute, single decision.changed dispatch on a flip —
 * a combined PATCH must not emit intermediate states to SSE/webhook consumers.
 * Caller MUST have authorized owner + validated fields.
 */
export async function updateReviewSettings(
  userId: string,
  documentId: string,
  patch: { requiredApprovals?: number; requireBlockerResolution?: boolean },
): Promise<string> {
  const data: { requiredApprovals?: number; requireBlockerResolution?: boolean } = {};
  if (patch.requiredApprovals !== undefined) data.requiredApprovals = patch.requiredApprovals;
  if (patch.requireBlockerResolution !== undefined) data.requireBlockerResolution = patch.requireBlockerResolution;
  await prisma.document.update({ where: { id: documentId }, data });
  const { state, prevState } = await recomputeState(documentId);
  if (state !== prevState) {
    await dispatch(documentId, "decision.changed", { decision: state.toLowerCase() }, userId).catch(() => {});
  }
  return state;
}

/**
 * Owner sets the approval threshold. Caller MUST have authorized owner + validated n (1–10).
 * Recomputes state, publishes review.updated, dispatches decision.changed on a flip.
 * Does NOT notify participants (no new review occurred).
 */
export async function setRequiredApprovals(userId: string, documentId: string, n: number): Promise<string> {
  return updateReviewSettings(userId, documentId, { requiredApprovals: n });
}

/**
 * Blocker-gate recompute for annotation-side mutations (thread resolve/reopen,
 * BLOCKER created, suggestion applied). No-op unless the document opted into
 * requireBlockerResolution — without the gate, annotations can't change state.
 * Mirrors submitReview's decision.changed dispatch on a flip.
 */
export async function recomputeStateForBlockerGate(userId: string, documentId: string): Promise<void> {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { requireBlockerResolution: true } });
  if (!doc?.requireBlockerResolution) return;
  const { state, prevState } = await recomputeState(documentId);
  if (state !== prevState) {
    await dispatch(documentId, "decision.changed", { decision: state.toLowerCase() }, userId).catch(() => {});
  }
}

/** Owner toggles the blocker gate. Caller MUST have authorized owner. Recomputes
 *  state (toggling can immediately flip APPROVED ↔ CHANGES_REQUESTED). */
export async function setRequireBlockerResolution(userId: string, documentId: string, enabled: boolean): Promise<string> {
  return updateReviewSettings(userId, documentId, { requireBlockerResolution: enabled });
}

/**
 * Recompute + persist document state and dispatch decision.changed on a flip.
 * Used after a participant removal dismisses that user's reviews (lib/sharing.ts),
 * where the removal itself isn't a review event but can still change the outcome.
 * Unlike recomputeStateForBlockerGate, always recomputes (no gate-only guard).
 */
export async function recomputeStateAndDispatch(actorId: string, documentId: string): Promise<string> {
  const { state, prevState } = await recomputeState(documentId);
  if (state !== prevState) {
    await dispatch(documentId, "decision.changed", { decision: state.toLowerCase() }, actorId).catch(() => {});
  }
  return state;
}
