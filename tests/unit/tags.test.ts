import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { normalizeTagName, setDocumentTags, listAllTags } from "@/lib/tags";

let userSeq = 0;
async function makeUser() {
  const now = new Date();
  const id = `u-${Date.now()}-${++userSeq}-${Math.round(Math.random() * 1e6)}`;
  return prisma.user.create({
    data: { id, name: "U", email: `${id}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

async function docTags(documentId: string): Promise<string[]> {
  const rows = await prisma.documentTag.findMany({
    where: { documentId },
    select: { tag: { select: { name: true } } },
    orderBy: { tag: { name: "asc" } },
  });
  return rows.map((r) => r.tag.name);
}

describe("normalizeTagName", () => {
  it("trims, collapses whitespace, lowercases", () => {
    expect(normalizeTagName("  Security   Review ")).toBe("security review");
  });
  it("rejects empty and whitespace-only", () => {
    expect(normalizeTagName("")).toBeNull();
    expect(normalizeTagName("   ")).toBeNull();
  });
  it("rejects names longer than 50 chars", () => {
    expect(normalizeTagName("x".repeat(51))).toBeNull();
    expect(normalizeTagName("x".repeat(50))).toBe("x".repeat(50));
  });
});

describe("setDocumentTags", () => {
  it("adds, removes, and dedups via replace-set", async () => {
    const owner = await makeUser();
    const id = await createDocument(owner.id, "Plan", "body");

    const r1 = await setDocumentTags(id, ["Security", "  infra "]);
    expect(r1).toEqual({ ok: true, tags: ["security", "infra"] });
    expect(await docTags(id)).toEqual(["infra", "security"]);

    // replace: drop infra, keep security, add ops; duplicate input collapses
    const r2 = await setDocumentTags(id, ["security", "ops", "OPS"]);
    expect(r2).toEqual({ ok: true, tags: ["security", "ops"] });
    expect(await docTags(id)).toEqual(["ops", "security"]);

    // clear
    const r3 = await setDocumentTags(id, []);
    expect(r3).toEqual({ ok: true, tags: [] });
    expect(await docTags(id)).toEqual([]);

    await prisma.document.delete({ where: { id } });
  });

  it("rejects an invalid tag without changing anything", async () => {
    const owner = await makeUser();
    const id = await createDocument(owner.id, "Plan", "body");
    await setDocumentTags(id, ["keep"]);

    const r = await setDocumentTags(id, ["ok", "   "]);
    expect(r).toEqual({ ok: false, error: "invalid_tag" });
    expect(await docTags(id)).toEqual(["keep"]);

    await prisma.document.delete({ where: { id } });
  });
});

describe("listAllTags", () => {
  it("returns global names alphabetically, including tags from other users' docs", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const docA = await createDocument(a.id, "A", "body");
    const docB = await createDocument(b.id, "B", "body");
    const marker = `zz-global-${Date.now()}`;
    await setDocumentTags(docA, [`${marker}-1`]);
    await setDocumentTags(docB, [`${marker}-2`]);

    const all = await listAllTags();
    // Scope the order assertion to this test's own markers so unrelated tags
    // left behind by other suites can't flake it via collation differences.
    const mine = all.filter((n) => n.startsWith(marker));
    expect(mine).toEqual([`${marker}-1`, `${marker}-2`]);

    await prisma.document.delete({ where: { id: docA } });
    await prisma.document.delete({ where: { id: docB } });
  });
});
