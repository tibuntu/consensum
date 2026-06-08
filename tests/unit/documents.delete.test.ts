import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument, deleteDocument } from "@/lib/documents";

let userSeq = 0;
async function makeUser(email: string) {
  const now = new Date();
  return prisma.user.create({
    data: { id: `u-${++userSeq}-${email}`, name: email.split("@")[0], email, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

describe("deleteDocument", () => {
  beforeEach(async () => {
    await prisma.comment.deleteMany();
    await prisma.review.deleteMany();
    await prisma.annotation.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.documentParticipant.deleteMany();
    await prisma.document.deleteMany();
    await prisma.documentVersion.deleteMany();
    await prisma.user.deleteMany();
  });

  it("removes a fully-populated document with no orphans", async () => {
    const owner = await makeUser("owner@example.com");
    const id = await createDocument(owner.id, "Plan", "# v1 body");
    const v1 = await prisma.documentVersion.findFirstOrThrow({ where: { documentId: id } });

    // annotation created on v1, with a comment
    const ann = await prisma.annotation.create({
      data: {
        documentId: id, createdOnVersionId: v1.id,
        anchorExact: "v1", anchorPrefix: "# ", anchorSuffix: " body",
        startOffset: 2, endOffset: 4, kind: "COMMENT", threadStatus: "OPEN", status: "ACTIVE",
        authorId: owner.id,
      },
    });
    await prisma.comment.create({ data: { annotationId: ann.id, authorId: owner.id, body: "hi" } });
    // a review tied to v1 (Review.onVersion Restrict)
    await prisma.review.create({ data: { documentId: id, reviewerId: owner.id, onVersionId: v1.id, verdict: "COMMENT" } });
    // a notification on the document (Notification.document Cascade)
    await prisma.notification.create({ data: { userId: owner.id, documentId: id, type: "REVIEW" } });
    // an annotation marked applied in v1 (Annotation.appliedInVersion Restrict)
    await prisma.annotation.update({ where: { id: ann.id }, data: { appliedInVersionId: v1.id } });

    await deleteDocument(id);

    expect(await prisma.document.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.documentVersion.count({ where: { documentId: id } })).toBe(0);
    expect(await prisma.annotation.count({ where: { documentId: id } })).toBe(0);
    expect(await prisma.comment.count({ where: { annotationId: ann.id } })).toBe(0);
    expect(await prisma.review.count({ where: { documentId: id } })).toBe(0);
    expect(await prisma.documentParticipant.count({ where: { documentId: id } })).toBe(0);
    expect(await prisma.notification.count({ where: { documentId: id } })).toBe(0);
  });
});
