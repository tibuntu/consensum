import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/plans/[id]/claim/route";
import { createDocument, deleteDocument, listDocuments } from "@/lib/documents";
import { generateToken } from "@/lib/tokens";

let n = 0;
async function makeUser() {
  const now = new Date();
  n++;
  const tag = `${Date.now()}-${n}`;
  return prisma.user.create({
    data: { id: `u-pc-${tag}`, name: "U", email: `u-pc-${tag}@example.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}
function claimReq(token: string) {
  return new Request("http://localhost/api/plans/x/claim", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function makePlanWithReviewer() {
  const owner = await makeUser();
  const reviewer = await makeUser();
  const { token } = await generateToken(reviewer.id, "ci", { scopes: "plans:write,feedback:read" });
  const docId = await createDocument(owner.id, "P", "body");
  await prisma.documentParticipant.create({ data: { documentId: docId, userId: reviewer.id, role: "REVIEWER" } });
  return { owner, reviewer, token, docId };
}

describe("POST /api/plans/[id]/claim", () => {
  test("reviewer claim → ownership swapped, old owner demoted + notified", async () => {
    const { owner, reviewer, token, docId } = await makePlanWithReviewer();
    await prisma.document.update({ where: { id: docId }, data: { idempotencyKey: "old-key" } });

    const res = await POST(claimReq(token), ctx(docId));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ id: docId, role: "OWNER", versionNumber: 1 });

    const doc = await prisma.document.findUnique({ where: { id: docId } });
    expect(doc?.ownerId).toBe(reviewer.id);
    expect(doc?.idempotencyKey).toBeNull();

    const oldOwnerRow = await prisma.documentParticipant.findUnique({
      where: { documentId_userId: { documentId: docId, userId: owner.id } },
    });
    expect(oldOwnerRow?.role).toBe("REVIEWER");

    const claimerRow = await prisma.documentParticipant.findUnique({
      where: { documentId_userId: { documentId: docId, userId: reviewer.id } },
    });
    expect(claimerRow).not.toBeNull();
    expect(claimerRow?.required).toBe(false);

    const notif = await prisma.notification.findFirst({
      where: { documentId: docId, userId: owner.id, type: "ownership_claimed" },
    });
    expect(notif?.actorId).toBe(reviewer.id);
    await deleteDocument(docId);
  });

  test("VIEWER → 403", async () => {
    const owner = await makeUser();
    const viewer = await makeUser();
    const { token } = await generateToken(viewer.id, "ci", { scopes: "plans:write,feedback:read" });
    const docId = await createDocument(owner.id, "P", "body");
    await prisma.documentParticipant.create({ data: { documentId: docId, userId: viewer.id, role: "VIEWER" } });
    expect((await POST(claimReq(token), ctx(docId))).status).toBe(403);
    await deleteDocument(docId);
  });

  test("owner claiming own plan → 409", async () => {
    const owner = await makeUser();
    const { token } = await generateToken(owner.id, "ci", { scopes: "plans:write,feedback:read" });
    const docId = await createDocument(owner.id, "P", "body");
    expect((await POST(claimReq(token), ctx(docId))).status).toBe(409);
    await deleteDocument(docId);
  });

  test("stranger on PRIVATE doc → 404", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const { token } = await generateToken(stranger.id, "ci", { scopes: "plans:write,feedback:read" });
    const docId = await createDocument(owner.id, "P", "body");
    expect((await POST(claimReq(token), ctx(docId))).status).toBe(404);
    await deleteDocument(docId);
  });

  test("archived doc → 409", async () => {
    const { token, docId } = await makePlanWithReviewer();
    await prisma.document.update({ where: { id: docId }, data: { archivedAt: new Date() } });
    expect((await POST(claimReq(token), ctx(docId))).status).toBe(409);
    await deleteDocument(docId);
  });

  test("missing plans:write scope → 403", async () => {
    const { reviewer, docId } = await makePlanWithReviewer();
    const { token } = await generateToken(reviewer.id, "ro", { scopes: "feedback:read" });
    expect((await POST(claimReq(token), ctx(docId))).status).toBe(403);
    await deleteDocument(docId);
  });

  test("stranger on LINK doc claims in one call via auto-join", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const { token } = await generateToken(stranger.id, "ci", { scopes: "plans:write,feedback:read" });
    const docId = await createDocument(owner.id, "P", "body");
    await prisma.document.update({ where: { id: docId }, data: { visibility: "LINK" } });
    const res = await POST(claimReq(token), ctx(docId));
    expect(res.status).toBe(200);
    expect((await prisma.document.findUnique({ where: { id: docId } }))?.ownerId).toBe(stranger.id);
    await deleteDocument(docId);
  });

  test("claimed plan stays visible in the new owner's document list", async () => {
    const { reviewer, token, docId } = await makePlanWithReviewer();
    expect((await POST(claimReq(token), ctx(docId))).status).toBe(200);
    const row = await prisma.documentParticipant.findUnique({
      where: { documentId_userId: { documentId: docId, userId: reviewer.id } },
    });
    expect(row).not.toBeNull();
    expect(row?.required).toBe(false);
    const docs = await listDocuments(reviewer.id);
    expect(docs.map((d) => d.id)).toContain(docId);
    await deleteDocument(docId);
  });

  test("claimer's prior review is dismissed so it can't approve their own plan", async () => {
    const { reviewer, token, docId } = await makePlanWithReviewer();
    const version = await prisma.documentVersion.findFirst({ where: { documentId: docId, versionNumber: 1 } });
    const review = await prisma.review.create({
      data: { documentId: docId, reviewerId: reviewer.id, verdict: "APPROVE", onVersionId: version!.id },
    });
    expect((await POST(claimReq(token), ctx(docId))).status).toBe(200);
    expect((await prisma.review.findUnique({ where: { id: review.id } }))?.dismissed).toBe(true);
    await deleteDocument(docId);
  });
});
