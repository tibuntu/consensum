import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { createAnnotation } from "@/lib/annotations";
import { buildQuote } from "@/lib/anchoring";
import { resolveAccess, documentIdForAnnotation } from "@/lib/authz";

let userSeq = 0;
async function makeUser() {
  const now = new Date();
  const id = `u-${Date.now()}-${++userSeq}-${Math.round(Math.random() * 1e6)}`;
  return prisma.user.create({
    data: { id, name: "U", email: `${id}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

describe("resolveAccess", () => {
  it("owner gets full capabilities", async () => {
    const owner = await makeUser();
    const id = await createDocument(owner.id, "Plan", "body");

    const access = await resolveAccess(owner.id, id);
    expect(access).toEqual({ role: "OWNER", canView: true, canReview: true, canManage: true, visibility: "PRIVATE", archived: false });

    await prisma.document.delete({ where: { id } });
  });

  it("reviewer participant can view and review but not manage", async () => {
    const owner = await makeUser();
    const reviewer = await makeUser();
    const id = await createDocument(owner.id, "Plan", "body");
    await prisma.documentParticipant.create({ data: { documentId: id, userId: reviewer.id, role: "REVIEWER" } });

    const access = await resolveAccess(reviewer.id, id);
    expect(access).toEqual({ role: "REVIEWER", canView: true, canReview: true, canManage: false, visibility: "PRIVATE", archived: false });

    await prisma.document.delete({ where: { id } });
  });

  it("viewer participant can view only", async () => {
    const owner = await makeUser();
    const viewer = await makeUser();
    const id = await createDocument(owner.id, "Plan", "body");
    await prisma.documentParticipant.create({ data: { documentId: id, userId: viewer.id, role: "VIEWER" } });

    const access = await resolveAccess(viewer.id, id);
    expect(access).toEqual({ role: "VIEWER", canView: true, canReview: false, canManage: false, visibility: "PRIVATE", archived: false });

    await prisma.document.delete({ where: { id } });
  });

  it("LINK doc auto-joins a stranger with no row as REVIEWER (side effect)", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const id = await createDocument(owner.id, "Plan", "body");
    await prisma.document.update({ where: { id }, data: { visibility: "LINK" } });

    const before = await prisma.documentParticipant.findUnique({
      where: { documentId_userId: { documentId: id, userId: stranger.id } },
    });
    expect(before).toBeNull();

    const access = await resolveAccess(stranger.id, id);
    expect(access).toEqual({ role: "REVIEWER", canView: true, canReview: true, canManage: false, visibility: "LINK", archived: false });

    const after = await prisma.documentParticipant.findUnique({
      where: { documentId_userId: { documentId: id, userId: stranger.id } },
    });
    expect(after?.role).toBe("REVIEWER");

    await prisma.document.delete({ where: { id } });
  });

  it("archived doc: owner keeps manage but loses review", async () => {
    const owner = await makeUser();
    const id = await createDocument(owner.id, "Plan", "body");
    await prisma.document.update({ where: { id }, data: { archivedAt: new Date() } });

    const access = await resolveAccess(owner.id, id);
    expect(access).toEqual({ role: "OWNER", canView: true, canReview: false, canManage: true, visibility: "PRIVATE", archived: true });

    await prisma.document.delete({ where: { id } });
  });

  it("archived doc: reviewer participant loses review", async () => {
    const owner = await makeUser();
    const reviewer = await makeUser();
    const id = await createDocument(owner.id, "Plan", "body");
    await prisma.documentParticipant.create({ data: { documentId: id, userId: reviewer.id, role: "REVIEWER" } });
    await prisma.document.update({ where: { id }, data: { archivedAt: new Date() } });

    const access = await resolveAccess(reviewer.id, id);
    expect(access).toEqual({ role: "REVIEWER", canView: true, canReview: false, canManage: false, visibility: "PRIVATE", archived: true });

    await prisma.document.delete({ where: { id } });
  });

  it("PRIVATE doc returns null for a stranger with no row, and creates no row", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const id = await createDocument(owner.id, "Plan", "body");

    const access = await resolveAccess(stranger.id, id);
    expect(access).toBeNull();

    const row = await prisma.documentParticipant.findUnique({
      where: { documentId_userId: { documentId: id, userId: stranger.id } },
    });
    expect(row).toBeNull();

    await prisma.document.delete({ where: { id } });
  });

  it("returns null for a missing document", async () => {
    const user = await makeUser();
    expect(await resolveAccess(user.id, "does-not-exist")).toBeNull();
  });
});

describe("documentIdForAnnotation", () => {
  it("resolves or returns null", async () => {
    const owner = await makeUser();
    const md = "The cloud setup needs review.";
    const id = await createDocument(owner.id, "Plan", md);
    const start = md.indexOf("cloud setup");
    const ann = await createAnnotation(owner.id, id, { quote: buildQuote(md, start, start + 11), startOffset: start, endOffset: start + 11 }, "note");
    expect(await documentIdForAnnotation(ann.id)).toBe(id);
    expect(await documentIdForAnnotation("missing")).toBeNull();
    await prisma.document.delete({ where: { id } });
  });
});
