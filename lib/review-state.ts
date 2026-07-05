import type { ReviewVerdict, DocumentState } from "@/lib/enums";

export interface ReviewInput {
  verdict: ReviewVerdict;
  dismissed: boolean;
}

/** Opt-in approval gate: while `openBlockers > 0`, the approval threshold being
 *  met yields CHANGES_REQUESTED instead of APPROVED (an open BLOCKER thread is,
 *  literally, an outstanding change request). Only the OPEN→APPROVED transition
 *  is gated; with the gate absent or off, behavior is unchanged. */
export interface BlockerGate {
  requireBlockerResolution: boolean;
  openBlockers: number;
}

export function computeDocumentState(
  reviews: ReviewInput[],
  requiredApprovals: number,
  gate?: BlockerGate,
): DocumentState {
  const active = reviews.filter((r) => !r.dismissed);
  if (active.some((r) => r.verdict === "REQUEST_CHANGES")) return "CHANGES_REQUESTED";
  const approvals = active.filter((r) => r.verdict === "APPROVE").length;
  if (approvals >= requiredApprovals) {
    if (gate?.requireBlockerResolution && gate.openBlockers > 0) return "CHANGES_REQUESTED";
    return "APPROVED";
  }
  return "OPEN";
}
