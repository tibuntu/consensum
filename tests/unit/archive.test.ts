import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { createVersion, ArchivedError } from "@/lib/versions";

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
