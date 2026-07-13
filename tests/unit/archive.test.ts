import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument, listDocuments, listReviewQueue, setArchived } from "@/lib/documents";
import { createVersion, ArchivedError } from "@/lib/versions";
import { setDocumentTags } from "@/lib/tags";

let userSeq = 0;
async function makeUser() {
  const now = new Date();
  const id = `u-${Date.now()}-${++userSeq}-${Math.round(Math.random() * 1e6)}`;
  return prisma.user.create({
    data: { id, name: "U", email: `${id}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

describe("createVersion on archived documents", () => {
  it("throws ArchivedError", async () => {
    const owner = await makeUser();
    const id = await createDocument(owner.id, "Plan", "body");
    await prisma.document.update({ where: { id }, data: { archivedAt: new Date() } });

    await expect(createVersion(owner.id, id, 1, "new body")).rejects.toBeInstanceOf(ArchivedError);

    await prisma.document.delete({ where: { id } });
  });

  it("throws ArchivedError even when markdown is unchanged", async () => {
    const owner = await makeUser();
    const id = await createDocument(owner.id, "Plan", "body");
    await prisma.document.update({ where: { id }, data: { archivedAt: new Date() } });

    await expect(createVersion(owner.id, id, 1, "body")).rejects.toBeInstanceOf(ArchivedError);

    await prisma.document.delete({ where: { id } });
  });

  it("still creates versions on active documents", async () => {
    const owner = await makeUser();
    const id = await createDocument(owner.id, "Plan", "body");

    const result = await createVersion(owner.id, id, 1, "new body");
    expect(result.unchanged).toBe(false);

    await prisma.document.delete({ where: { id } });
  });
});

describe("archive listing behavior", () => {
  it("setArchived flips archivedAt; listDocuments hides archived unless asked", async () => {
    const owner = await makeUser();
    const active = await createDocument(owner.id, "Active", "body");
    const archived = await createDocument(owner.id, "Archived", "body");

    await setArchived(archived, true);
    const row = await prisma.document.findUnique({ where: { id: archived }, select: { archivedAt: true } });
    expect(row?.archivedAt).toBeInstanceOf(Date);

    const defaults = await listDocuments(owner.id);
    expect(defaults.map((d) => d.id)).toContain(active);
    expect(defaults.map((d) => d.id)).not.toContain(archived);

    const withArchived = await listDocuments(owner.id, { includeArchived: true });
    expect(withArchived.map((d) => d.id)).toContain(archived);

    await setArchived(archived, false);
    const cleared = await prisma.document.findUnique({ where: { id: archived }, select: { archivedAt: true } });
    expect(cleared?.archivedAt).toBeNull();

    await prisma.document.delete({ where: { id: active } });
    await prisma.document.delete({ where: { id: archived } });
  });

  it("listDocuments rows carry sorted tag names", async () => {
    const owner = await makeUser();
    const id = await createDocument(owner.id, "Tagged", "body");
    await setDocumentTags(id, ["zeta", "alpha"]);

    const docs = await listDocuments(owner.id);
    const doc = docs.find((d) => d.id === id);
    expect(doc?.tags.map((t) => t.tag.name)).toEqual(["alpha", "zeta"]);

    await prisma.document.delete({ where: { id } });
  });

  it("archived docs vanish from both queue tiers", async () => {
    const owner = await makeUser();
    const reviewer = await makeUser();
    const blockingDoc = await createDocument(owner.id, "Blocking", "body");
    const openDoc = await createDocument(owner.id, "OpenReview", "body");
    await prisma.documentParticipant.create({ data: { documentId: blockingDoc, userId: reviewer.id, role: "REVIEWER", required: true } });
    await prisma.documentParticipant.create({ data: { documentId: openDoc, userId: reviewer.id, role: "REVIEWER", required: false } });

    const before = await listReviewQueue(reviewer.id);
    expect(before.blocking.map((d) => d.id)).toContain(blockingDoc);
    expect(before.openReviews.map((d) => d.id)).toContain(openDoc);

    await setArchived(blockingDoc, true);
    await setArchived(openDoc, true);

    const after = await listReviewQueue(reviewer.id);
    expect(after.blocking.map((d) => d.id)).not.toContain(blockingDoc);
    expect(after.openReviews.map((d) => d.id)).not.toContain(openDoc);

    await prisma.document.delete({ where: { id: blockingDoc } });
    await prisma.document.delete({ where: { id: openDoc } });
  });
});
