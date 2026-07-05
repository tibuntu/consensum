import type { ReviewVerdict, DocumentState } from "@/lib/enums";

export interface ReviewInput {
  verdict: ReviewVerdict;
  dismissed: boolean;
  reviewerId?: string;
}

/** Opt-in approval gate: while `openBlockers > 0`, the approval threshold being
 *  met yields CHANGES_REQUESTED instead of APPROVED (an open BLOCKER thread is,
 *  literally, an outstanding change request). Only the OPEN→APPROVED transition
 *  is gated; with the gate absent or off, behavior is unchanged. */
export interface BlockerGate {
  requireBlockerResolution: boolean;
  openBlockers: number;
}

/**
 * Required reviewers (M9): every id in `requiredReviewerIds` must have an active
 * APPROVE for APPROVED. Missing a required approval (with no REQUEST_CHANGES)
 * yields OPEN — an unmet requirement isn't a change request. Their approvals also
 * count toward `requiredApprovals`, which stays a floor.
 */
export function computeDocumentState(
  reviews: ReviewInput[],
  requiredApprovals: number,
  gate?: BlockerGate,
  requiredReviewerIds: string[] = [],
): DocumentState {
  const active = reviews.filter((r) => !r.dismissed);
  if (active.some((r) => r.verdict === "REQUEST_CHANGES")) return "CHANGES_REQUESTED";
  const approvals = active.filter((r) => r.verdict === "APPROVE");
  if (approvals.length < requiredApprovals) return "OPEN";
  if (gate?.requireBlockerResolution && gate.openBlockers > 0) return "CHANGES_REQUESTED";
  const approverIds = new Set(approvals.map((r) => r.reviewerId));
  if (!requiredReviewerIds.every((id) => approverIds.has(id))) return "OPEN";
  return "APPROVED";
}
