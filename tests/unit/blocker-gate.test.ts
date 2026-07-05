import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { submitReview, setRequireBlockerResolution } from "@/lib/reviews";
import { createAnnotation, setThreadStatus } from "@/lib/annotations";

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
});
