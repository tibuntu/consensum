import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { addLink, listLinks, removeLink } from "@/lib/links";

let n = 0;
async function makeUser() {
  const now = new Date();
  const tag = `${Date.now()}-${++n}`;
  return prisma.user.create({
    data: { id: `u-lnk-${tag}`, name: "U", email: `u-lnk-${tag}@example.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

describe("links service", () => {
  it("validates url, label, and kind", async () => {
    const owner = await makeUser();
    const id = await createDocument(owner.id, "Plan", "body");
    expect(await addLink(owner.id, id, { url: "not a url" })).toEqual({ error: "invalid_url" });
    expect(await addLink(owner.id, id, { url: "ftp://example.com/x" })).toEqual({ error: "invalid_url" });
    expect(await addLink(owner.id, id, { url: `https://example.com/${"a".repeat(2048)}` })).toEqual({ error: "url_too_long" });
    expect(await addLink(owner.id, id, { url: "https://example.com/pr/1", label: "x".repeat(201) })).toEqual({ error: "label_too_long" });
    expect(await addLink(owner.id, id, { url: "https://example.com/pr/1", kind: "issue" })).toEqual({ error: "invalid_kind" });

    // Trailing whitespace is accepted and the stored URL is WHATWG-normalized.
    const c = await addLink(owner.id, id, { url: "https://example.com/pr/3  " });
    expect("link" in c).toBe(true);
    expect("link" in c && c.link.url).toBe("https://example.com/pr/3");

    await prisma.document.delete({ where: { id } });
  });

  it("adds with default kind, lists in insertion order, removes scoped by document", async () => {
    const owner = await makeUser();
    const id = await createDocument(owner.id, "Plan", "body");
    const other = await createDocument(owner.id, "Other", "body");

    const a = await addLink(owner.id, id, { url: "https://example.com/pr/1", label: "PR #1", kind: "pr" });
    const b = await addLink(owner.id, id, { url: "https://example.com/commit/abc" });
    expect("link" in a && a.link.kind).toBe("pr");
    expect("link" in b && b.link.kind).toBe("other");

    const links = await listLinks(id);
    expect(links.map((l) => l.url)).toEqual(["https://example.com/pr/1", "https://example.com/commit/abc"]);

    // A linkId can't be deleted through another document's scope.
    const linkId = "link" in a ? a.link.id : "";
    expect(await removeLink(other, linkId)).toEqual({ error: "not_found" });
    expect(await removeLink(id, linkId)).toEqual({ ok: true });
    expect((await listLinks(id)).map((l) => l.url)).toEqual(["https://example.com/commit/abc"]);

    await prisma.document.delete({ where: { id } });
    await prisma.document.delete({ where: { id: other } });
  });

  it("notifies non-actor participants with type implementation", async () => {
    const owner = await makeUser();
    const reviewer = await makeUser();
    const id = await createDocument(owner.id, "Plan", "body");
    await prisma.documentParticipant.create({ data: { documentId: id, userId: reviewer.id, role: "REVIEWER" } });

    await addLink(owner.id, id, { url: "https://example.com/pr/2" });

    const toReviewer = await prisma.notification.findMany({ where: { userId: reviewer.id, documentId: id, type: "implementation" } });
    const toActor = await prisma.notification.findMany({ where: { userId: owner.id, documentId: id, type: "implementation" } });
    expect(toReviewer).toHaveLength(1);
    expect(toActor).toHaveLength(0);

    await prisma.document.delete({ where: { id } });
  });
});
