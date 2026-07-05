import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { submitReview, setRequireBlockerResolution } from "@/lib/reviews";
import { createAnnotation, setThreadStatus, applySuggestion } from "@/lib/annotations";
import { createVersion } from "@/lib/versions";

async function makeUser(label: string) {
  const now = new Date();
  return prisma.user.create({
    data: { id: `u-${label}-${Date.now()}-${Math.round(Math.random()*1e6)}`, name: "x", email: `u-${label}-${Date.now()}-${Math.round(Math.random()*1e6)}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

async function docState(id: string): Promise<string | undefined> {
  return (await prisma.document.findUnique({ where: { id } }))?.state;
}

describe("blocker gate end-to-end (lib layer)", () => {
  test("approve with open BLOCKER on gated doc → CHANGES_REQUESTED; resolve → APPROVED; reopen → CHANGES_REQUESTED", async () => {
    const owner = await makeUser("o");
    const reviewer = await makeUser("r");
    const docId = await createDocument(owner.id, "P", "body", { requireBlockerResolution: true });
    const ann = await createAnnotation(reviewer.id, docId, { scope: "DOCUMENT", severity: "BLOCKER" }, "must fix");

    await submitReview(reviewer.id, docId, "APPROVE");
    expect(await docState(docId)).toBe("CHANGES_REQUESTED");

    await setThreadStatus(reviewer.id, ann.id, "RESOLVED", "FIXED");
    expect(await docState(docId)).toBe("APPROVED");

    await setThreadStatus(reviewer.id, ann.id, "OPEN");
    expect(await docState(docId)).toBe("CHANGES_REQUESTED");
  });

  test("new BLOCKER thread on gated APPROVED doc revokes approval", async () => {
    const owner = await makeUser("o2");
    const reviewer = await makeUser("r2");
    const docId = await createDocument(owner.id, "P", "body", { requireBlockerResolution: true });
    await submitReview(reviewer.id, docId, "APPROVE");
    expect(await docState(docId)).toBe("APPROVED");

    await createAnnotation(reviewer.id, docId, { scope: "DOCUMENT", severity: "BLOCKER" }, "wait — rollback plan?");
    expect(await docState(docId)).toBe("CHANGES_REQUESTED");
  });

  test("ungated doc: open BLOCKER does not block approval", async () => {
    const owner = await makeUser("o3");
    const reviewer = await makeUser("r3");
    const docId = await createDocument(owner.id, "P", "body");
    await createAnnotation(reviewer.id, docId, { scope: "DOCUMENT", severity: "BLOCKER" }, "note");
    await submitReview(reviewer.id, docId, "APPROVE");
    expect(await docState(docId)).toBe("APPROVED");
  });

  test("non-BLOCKER threads never trigger the gate", async () => {
    const owner = await makeUser("o4");
    const reviewer = await makeUser("r4");
    const docId = await createDocument(owner.id, "P", "body", { requireBlockerResolution: true });
    await createAnnotation(reviewer.id, docId, { scope: "DOCUMENT", severity: "MAJOR" }, "minor gripe");
    await submitReview(reviewer.id, docId, "APPROVE");
    expect(await docState(docId)).toBe("APPROVED");
  });

  test("toggling the gate on an APPROVED doc with an open BLOCKER flips state both ways", async () => {
    const owner = await makeUser("o5");
    const reviewer = await makeUser("r5");
    const docId = await createDocument(owner.id, "P", "body");
    await createAnnotation(reviewer.id, docId, { scope: "DOCUMENT", severity: "BLOCKER" }, "hold on");
    await submitReview(reviewer.id, docId, "APPROVE");
    expect(await docState(docId)).toBe("APPROVED");

    expect(await setRequireBlockerResolution(owner.id, docId, true)).toBe("CHANGES_REQUESTED");
    expect(await setRequireBlockerResolution(owner.id, docId, false)).toBe("APPROVED");
  });

  test("applySuggestion resolves the BLOCKER thread and recomputes gated state", async () => {
    const owner = await makeUser("o6");
    const reviewer = await makeUser("r6");
    const markdown = "The rollback strategy is undefined.";
    const docId = await createDocument(owner.id, "P", markdown, { requireBlockerResolution: true });
    const startOffset = markdown.indexOf("undefined");
    const endOffset = startOffset + "undefined".length;
    const ann = await createAnnotation(
      reviewer.id,
      docId,
      {
        quote: { exact: "undefined", prefix: "strategy is ", suffix: "." },
        startOffset,
        endOffset,
        kind: "SUGGESTION",
        severity: "BLOCKER",
        suggestedText: "automated via terraform destroy",
      },
      "define rollback",
    );

    await submitReview(reviewer.id, docId, "APPROVE");
    expect(await docState(docId)).toBe("CHANGES_REQUESTED");

    await applySuggestion(owner.id, ann.id, 1);

    // Two recomputes happen on apply: createVersion's in-transaction recompute
    // runs while the thread is still OPEN, then the post-resolve blocker-gate
    // hook runs after the thread flips to RESOLVED. The final state is OPEN,
    // not APPROVED: applying the suggestion is a content change, so
    // createVersion dismissed the active approval — approval dismissal
    // dominates, and the gate no longer suppresses anything (0 open blockers,
    // but also 0 active approvals → threshold not met).
    expect(await docState(docId)).toBe("OPEN");

    const applied = await prisma.annotation.findUnique({ where: { id: ann.id } });
    expect(applied?.threadStatus).toBe("RESOLVED");
    expect(applied?.resolution).toBe("FIXED");
  });

  test("createVersion recomputes with gate inputs when a blocker stays open across a revision", async () => {
    const owner = await makeUser("o7");
    const reviewer = await makeUser("r7");
    const docId = await createDocument(owner.id, "P", "body", { requireBlockerResolution: true });
    await createAnnotation(reviewer.id, docId, { scope: "DOCUMENT", severity: "BLOCKER" }, "must fix");
    await submitReview(reviewer.id, docId, "APPROVE");
    expect(await docState(docId)).toBe("CHANGES_REQUESTED");

    await createVersion(owner.id, docId, 1, "revised body");

    // The in-transaction recompute ran with gate inputs (blocker still OPEN),
    // but the content change also dismissed the APPROVE review: zero active
    // approvals and no REQUEST_CHANGES verdicts compute OPEN — not APPROVED,
    // and not a stale CHANGES_REQUESTED carried over from the pre-revision gate.
    expect(await docState(docId)).toBe("OPEN");
  });
});
