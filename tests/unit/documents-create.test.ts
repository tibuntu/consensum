import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";

let userSeq = 0;
async function makeUser(email: string) {
  const now = new Date();
  return prisma.user.create({
    data: { id: `u-${++userSeq}-${email}`, name: email.split("@")[0], email, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

describe("createDocument visibility by source", () => {
  beforeEach(async () => {
    await prisma.documentParticipant.deleteMany();
    await prisma.review.deleteMany();
    await prisma.annotation.deleteMany();
    await prisma.documentVersion.deleteMany();
    await prisma.document.deleteMany();
    await prisma.user.deleteMany();
  });

  it("web docs are PRIVATE", async () => {
    const u = await makeUser("web@example.com");
    const id = await createDocument(u.id, "T", "body");
    const doc = await prisma.document.findUnique({ where: { id }, select: { visibility: true } });
    expect(doc?.visibility).toBe("PRIVATE");
  });

  it("agent docs are LINK", async () => {
    const u = await makeUser("agent@example.com");
    const id = await createDocument(u.id, "T", "body", { source: "CLAUDE_CODE" });
    const doc = await prisma.document.findUnique({ where: { id }, select: { visibility: true } });
    expect(doc?.visibility).toBe("LINK");
  });

  it("still creates the owner participant row", async () => {
    const u = await makeUser("owner@example.com");
    const id = await createDocument(u.id, "T", "body");
    const row = await prisma.documentParticipant.findUnique({
      where: { documentId_userId: { documentId: id, userId: u.id } },
    });
    expect(row).not.toBeNull();
    expect(row?.role).toBe("REVIEWER");
  });
});
