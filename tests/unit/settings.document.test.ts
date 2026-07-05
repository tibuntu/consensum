import { describe, expect, test, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { PATCH } from "@/app/api/documents/[id]/settings/route";
import { createDocument } from "@/lib/documents";
import * as api from "@/lib/api";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));

async function makeUser(label: string) {
  const now = new Date();
  return prisma.user.create({
    data: { id: `u-${label}-${Date.now()}-${Math.round(Math.random()*1e6)}`, name: "x", email: `u-${label}-${Date.now()}-${Math.round(Math.random()*1e6)}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}
const req = (b: unknown) => new Request("http://t", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("PATCH /api/documents/[id]/settings", () => {
  beforeEach(() => vi.mocked(api.requireUser).mockReset());

  test("owner sets a valid threshold → 200 + persisted", async () => {
    const owner = await makeUser("o");
    vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
    const docId = await createDocument(owner.id, "P", "body");
    const res = await PATCH(req({ requiredApprovals: 3 }), ctx(docId));
    expect(res.status).toBe(200);
    expect((await prisma.document.findUnique({ where: { id: docId } }))?.requiredApprovals).toBe(3);
  });

  test("invalid threshold → 400", async () => {
    const owner = await makeUser("o2");
    vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
    const docId = await createDocument(owner.id, "P", "body");
    expect((await PATCH(req({ requiredApprovals: 0 }), ctx(docId))).status).toBe(400);
    expect((await PATCH(req({ requiredApprovals: 99 }), ctx(docId))).status).toBe(400);
  });

  test("participant non-owner → 403", async () => {
    const owner = await makeUser("o3");
    const other = await makeUser("p3");
    const docId = await createDocument(owner.id, "P", "body");
    await prisma.documentParticipant.create({ data: { documentId: docId, userId: other.id } });
    vi.mocked(api.requireUser).mockResolvedValue({ id: other.id } as never);
    expect((await PATCH(req({ requiredApprovals: 2 }), ctx(docId))).status).toBe(403);
  });

  test("non-participant → 404", async () => {
    const owner = await makeUser("o4");
    const stranger = await makeUser("s4");
    const docId = await createDocument(owner.id, "P", "body");
    vi.mocked(api.requireUser).mockResolvedValue({ id: stranger.id } as never);
    expect((await PATCH(req({ requiredApprovals: 2 }), ctx(docId))).status).toBe(404);
  });
});

describe("PATCH /api/documents/[id]/settings — requireBlockerResolution", () => {
  test("owner enables the gate → 200 + persisted + state returned", async () => {
    const owner = await makeUser("g1");
    vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
    const docId = await createDocument(owner.id, "P", "body");
    const res = await PATCH(req({ requireBlockerResolution: true }), ctx(docId));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.requireBlockerResolution).toBe(true);
    expect(typeof data.state).toBe("string");
    expect((await prisma.document.findUnique({ where: { id: docId } }))?.requireBlockerResolution).toBe(true);
  });

  test("non-boolean gate → 400; empty body → 400", async () => {
    const owner = await makeUser("g2");
    vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
    const docId = await createDocument(owner.id, "P", "body");
    expect((await PATCH(req({ requireBlockerResolution: "yes" }), ctx(docId))).status).toBe(400);
    expect((await PATCH(req({}), ctx(docId))).status).toBe(400);
  });

  test("both fields in one request → both persisted", async () => {
    const owner = await makeUser("g3");
    vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
    const docId = await createDocument(owner.id, "P", "body");
    const res = await PATCH(req({ requiredApprovals: 2, requireBlockerResolution: true }), ctx(docId));
    expect(res.status).toBe(200);
    const doc = await prisma.document.findUnique({ where: { id: docId } });
    expect(doc?.requiredApprovals).toBe(2);
    expect(doc?.requireBlockerResolution).toBe(true);
  });
});
