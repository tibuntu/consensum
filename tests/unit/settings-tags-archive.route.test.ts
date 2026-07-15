import { describe, expect, test, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { PATCH } from "@/app/api/documents/[id]/settings/route";
import { GET as GET_TAGS } from "@/app/api/tags/route";
import { createDocument } from "@/lib/documents";
import * as api from "@/lib/api";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));

let userSeq = 0;
async function makeUser(label: string) {
  const now = new Date();
  const id = `u-${label}-${Date.now()}-${++userSeq}-${Math.round(Math.random() * 1e6)}`;
  return prisma.user.create({
    data: { id, name: `Name-${label}`, email: `${id}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

const jsonReq = (b: unknown) =>
  new Request("http://t", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("settings route: archived + tags", () => {
  beforeEach(() => vi.mocked(api.requireUser).mockReset());

  test("owner archives and unarchives", async () => {
    const owner = await makeUser("ar");
    const docId = await createDocument(owner.id, "P", "body");
    vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);

    const res = await PATCH(jsonReq({ archived: true }), ctx(docId));
    expect(res.status).toBe(200);
    expect((await res.json()).archived).toBe(true);
    const row = await prisma.document.findUnique({ where: { id: docId }, select: { archivedAt: true } });
    expect(row?.archivedAt).toBeInstanceOf(Date);

    const res2 = await PATCH(jsonReq({ archived: false }), ctx(docId));
    expect(res2.status).toBe(200);
    const row2 = await prisma.document.findUnique({ where: { id: docId }, select: { archivedAt: true } });
    expect(row2?.archivedAt).toBeNull();
  });

  test("non-boolean archived → 400", async () => {
    const owner = await makeUser("ab");
    const docId = await createDocument(owner.id, "P", "body");
    vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
    expect((await PATCH(jsonReq({ archived: "yes" }), ctx(docId))).status).toBe(400);
  });

  test("owner replace-sets tags and gets normalized names back", async () => {
    const owner = await makeUser("tg");
    const docId = await createDocument(owner.id, "P", "body");
    vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);

    const res = await PATCH(jsonReq({ tags: [" Security ", "infra"] }), ctx(docId));
    expect(res.status).toBe(200);
    expect((await res.json()).tags).toEqual(["security", "infra"]);
  });

  test("invalid tags → 400; non-array tags → 400", async () => {
    const owner = await makeUser("tv");
    const docId = await createDocument(owner.id, "P", "body");
    vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
    expect((await PATCH(jsonReq({ tags: ["ok", "   "] }), ctx(docId))).status).toBe(400);
    expect((await PATCH(jsonReq({ tags: "security" }), ctx(docId))).status).toBe(400);
    expect((await PATCH(jsonReq({ tags: [42] }), ctx(docId))).status).toBe(400);
  });

  test("non-owner participant → 403", async () => {
    const owner = await makeUser("no");
    const other = await makeUser("np");
    const docId = await createDocument(owner.id, "P", "body");
    await prisma.documentParticipant.create({ data: { documentId: docId, userId: other.id, role: "REVIEWER" } });
    vi.mocked(api.requireUser).mockResolvedValue({ id: other.id } as never);
    expect((await PATCH(jsonReq({ archived: true }), ctx(docId))).status).toBe(403);
  });
});

describe("GET /api/tags", () => {
  beforeEach(() => vi.mocked(api.requireUser).mockReset());

  test("signed-out → 401", async () => {
    vi.mocked(api.requireUser).mockResolvedValue(null as never);
    expect((await GET_TAGS()).status).toBe(401);
  });

  test("signed-in → sorted global names", async () => {
    const user = await makeUser("gt");
    vi.mocked(api.requireUser).mockResolvedValue({ id: user.id } as never);
    const res = await GET_TAGS();
    expect(res.status).toBe(200);
    const { tags } = await res.json();
    expect(Array.isArray(tags)).toBe(true);
    expect(tags).toEqual([...tags].sort());
  });
});
