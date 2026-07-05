import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { submitReview } from "@/lib/reviews";

let seq = 0;
async function makeUser(label: string) {
  const now = new Date();
  const id = `u-${label}-${Date.now()}-${++seq}-${Math.round(Math.random() * 1e6)}`;
  return prisma.user.create({
    data: { id, name: `Name-${label}`, email: `${id}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}
async function docState(id: string) {
  return (await prisma.document.findUnique({ where: { id } }))?.state;
}

describe("required reviewers recompute", () => {
  test("required reviewer gates APPROVED even when the threshold is otherwise met", async () => {
    const owner = await makeUser("o");
    const required = await makeUser("req");
    const other = await makeUser("oth");
    const docId = await createDocument(owner.id, "P", "body"); // requiredApprovals defaults 1
    await prisma.documentParticipant.create({ data: { documentId: docId, userId: required.id, role: "REVIEWER", required: true } });
    await prisma.documentParticipant.create({ data: { documentId: docId, userId: other.id, role: "REVIEWER" } });

    await submitReview(other.id, docId, "APPROVE");
    expect(await docState(docId)).toBe("OPEN");

    await submitReview(required.id, docId, "APPROVE");
    expect(await docState(docId)).toBe("APPROVED");

    await prisma.document.delete({ where: { id: docId } });
  });

  test("a required reviewer requesting changes yields CHANGES_REQUESTED", async () => {
    const owner = await makeUser("o2");
    const required = await makeUser("req2");
    const docId = await createDocument(owner.id, "P", "body");
    await prisma.documentParticipant.create({ data: { documentId: docId, userId: required.id, role: "REVIEWER", required: true } });

    await submitReview(required.id, docId, "REQUEST_CHANGES");
    expect(await docState(docId)).toBe("CHANGES_REQUESTED");

    await prisma.document.delete({ where: { id: docId } });
  });
});
