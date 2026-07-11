import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));

import { prisma } from "@/lib/db";
import * as api from "@/lib/api";
import { createDocument } from "@/lib/documents";
import { addLink } from "@/lib/links";

let n = 0;
async function makeUser() {
  const now = new Date();
  const tag = `${Date.now()}-${++n}`;
  return prisma.user.create({
    data: { id: `u-lw-${tag}`, name: "U", email: `u-lw-${tag}@example.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const ctx2 = (id: string, linkId: string) => ({ params: Promise.resolve({ id, linkId }) });
const post = (body: unknown) =>
  new Request("http://t/api/documents/x/links", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("web links routes", () => {
  beforeEach(() => {
    vi.mocked(api.requireUser).mockReset();
  });

  it("GET canView; POST canManage; DELETE canManage + document-scoped", async () => {
    const owner = await makeUser();
    const reviewer = await makeUser();
    const stranger = await makeUser();
    const id = await createDocument(owner.id, "Plan", "body");
    await prisma.documentParticipant.create({ data: { documentId: id, userId: reviewer.id, role: "REVIEWER" } });
    const seeded = await addLink(owner.id, id, { url: "https://example.com/pr/9" });
    const seededId = "link" in seeded ? seeded.link.id : "";

    const { GET, POST } = await import("@/app/api/documents/[id]/links/route");
    const { DELETE } = await import("@/app/api/documents/[id]/links/[linkId]/route");

    vi.mocked(api.requireUser).mockResolvedValueOnce(null as never);
    expect((await GET(new Request("http://t"), ctx(id))).status).toBe(401);

    vi.mocked(api.requireUser).mockResolvedValue({ id: stranger.id } as never);
    expect((await GET(new Request("http://t"), ctx(id))).status).toBe(404);
    expect((await POST(post({ url: "https://example.com/x" }), ctx(id))).status).toBe(404);

    vi.mocked(api.requireUser).mockResolvedValue({ id: reviewer.id } as never);
    const list = await GET(new Request("http://t"), ctx(id));
    expect(list.status).toBe(200);
    expect((await list.json()).links).toHaveLength(1);
    expect((await POST(post({ url: "https://example.com/x" }), ctx(id))).status).toBe(403);
    expect((await DELETE(new Request("http://t"), ctx2(id, seededId))).status).toBe(403);

    vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
    expect((await POST(post({ url: "bad url" }), ctx(id))).status).toBe(400);
    const created = await POST(post({ url: "https://example.com/branch/main", kind: "branch" }), ctx(id));
    expect(created.status).toBe(201);

    // linkId from another document → 404 via documentId scoping.
    const other = await createDocument(owner.id, "Other", "body");
    const foreign = await addLink(owner.id, other, { url: "https://example.com/pr/77" });
    const foreignId = "link" in foreign ? foreign.link.id : "";
    expect((await DELETE(new Request("http://t"), ctx2(id, foreignId))).status).toBe(404);

    expect((await DELETE(new Request("http://t"), ctx2(id, seededId))).status).toBe(200);

    await prisma.document.delete({ where: { id } });
    await prisma.document.delete({ where: { id: other } });
  });
});
