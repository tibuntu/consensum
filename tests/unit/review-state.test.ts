import { describe, it, expect } from "vitest";
import { computeDocumentState } from "@/lib/review-state";

describe("computeDocumentState", () => {
  it("is OPEN with no reviews", () => {
    expect(computeDocumentState([], 1)).toBe("OPEN");
  });
  it("is CHANGES_REQUESTED when any active review requests changes", () => {
    expect(computeDocumentState([{ verdict: "APPROVE", dismissed: false }, { verdict: "REQUEST_CHANGES", dismissed: false }], 1)).toBe("CHANGES_REQUESTED");
  });
  it("is APPROVED when approvals meet the threshold and no change requests", () => {
    expect(computeDocumentState([{ verdict: "APPROVE", dismissed: false }, { verdict: "APPROVE", dismissed: false }], 2)).toBe("APPROVED");
  });
  it("ignores dismissed reviews", () => {
    expect(computeDocumentState([{ verdict: "REQUEST_CHANGES", dismissed: true }, { verdict: "APPROVE", dismissed: false }], 1)).toBe("APPROVED");
  });
  it("is OPEN when approvals are below the threshold", () => {
    expect(computeDocumentState([{ verdict: "APPROVE", dismissed: false }], 2)).toBe("OPEN");
  });
  it("single veto beats N approvals (2-of-3 with one change request)", () => {
    expect(computeDocumentState([
      { verdict: "APPROVE", dismissed: false },
      { verdict: "APPROVE", dismissed: false },
      { verdict: "REQUEST_CHANGES", dismissed: false },
    ], 2)).toBe("CHANGES_REQUESTED");
  });
  it("is OPEN once all reviews are dismissed", () => {
    expect(computeDocumentState([
      { verdict: "APPROVE", dismissed: true },
      { verdict: "REQUEST_CHANGES", dismissed: true },
    ], 1)).toBe("OPEN");
  });
});

describe("blocker gate", () => {
  const approve = { verdict: "APPROVE" as const, dismissed: false };
  const reject = { verdict: "REQUEST_CHANGES" as const, dismissed: false };

  it("threshold met + open blockers + gate on → CHANGES_REQUESTED", () => {
    expect(computeDocumentState([approve], 1, { requireBlockerResolution: true, openBlockers: 1 })).toBe("CHANGES_REQUESTED");
  });

  it("threshold met + open blockers + gate off → APPROVED", () => {
    expect(computeDocumentState([approve], 1, { requireBlockerResolution: false, openBlockers: 1 })).toBe("APPROVED");
  });

  it("threshold met + no open blockers + gate on → APPROVED", () => {
    expect(computeDocumentState([approve], 1, { requireBlockerResolution: true, openBlockers: 0 })).toBe("APPROVED");
  });

  it("gate absent → APPROVED (legacy call shape)", () => {
    expect(computeDocumentState([approve], 1)).toBe("APPROVED");
  });

  it("threshold not met + gate on → OPEN, not CHANGES_REQUESTED", () => {
    expect(computeDocumentState([approve], 2, { requireBlockerResolution: true, openBlockers: 1 })).toBe("OPEN");
  });

  it("REQUEST_CHANGES still dominates with gate on and no blockers", () => {
    expect(computeDocumentState([approve, reject], 1, { requireBlockerResolution: true, openBlockers: 0 })).toBe("CHANGES_REQUESTED");
  });
});
