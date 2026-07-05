import { describe, expect, test, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET, POST } from "@/app/api/documents/[id]/participants/route";
import { PATCH as PATCH_PARTICIPANT, DELETE } from "@/app/api/documents/[id]/participants/[userId]/route";
import { PATCH as PATCH_SETTINGS } from "@/app/api/documents/[id]/settings/route";
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

const getReq = () => new Request("http://t", { method: "GET" });
const jsonReq = (method: string, b: unknown) =>
  new Request("http://t", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
const delReq = () => new Request("http://t", { method: "DELETE" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const ctxUser = (id: string, userId: string) => ({ params: Promise.resolve({ id, userId }) });

describe("participants routes", () => {
  beforeEach(() => vi.mocked(api.requireUser).mockReset());

  describe("GET /api/documents/[id]/participants", () => {
    test("non-owner participant → 403", async () => {
      const owner = await makeUser("go");
      const other = await makeUser("gp");
      const docId = await createDocument(owner.id, "P", "body");
      await prisma.documentParticipant.create({ data: { documentId: docId, userId: other.id, role: "REVIEWER" } });
      vi.mocked(api.requireUser).mockResolvedValue({ id: other.id } as never);
      expect((await GET(getReq(), ctx(docId))).status).toBe(403);
    });

    test("non-participant → 404", async () => {
      const owner = await makeUser("gn");
      const stranger = await makeUser("gs");
      const docId = await createDocument(owner.id, "P", "body");
      vi.mocked(api.requireUser).mockResolvedValue({ id: stranger.id } as never);
      expect((await GET(getReq(), ctx(docId))).status).toBe(404);
    });

    test("owner → 200 with participants", async () => {
      const owner = await makeUser("ga");
      const reviewer = await makeUser("gr");
      const docId = await createDocument(owner.id, "P", "body");
      await prisma.documentParticipant.create({ data: { documentId: docId, userId: reviewer.id, role: "REVIEWER" } });
      vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
      const res = await GET(getReq(), ctx(docId));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.participants.some((p: { userId: string; isOwner: boolean }) => p.userId === owner.id && p.isOwner)).toBe(true);
      expect(data.participants.some((p: { userId: string }) => p.userId === reviewer.id)).toBe(true);
    });
  });

  describe("POST /api/documents/[id]/participants", () => {
    test("owner shares with an unknown email → 409", async () => {
      const owner = await makeUser("po");
      const docId = await createDocument(owner.id, "P", "body");
      vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
      const res = await POST(jsonReq("POST", { email: "nobody@nowhere.com", role: "VIEWER" }), ctx(docId));
      expect(res.status).toBe(409);
    });

    test("owner shares with a valid email + role → 200 + row created", async () => {
      const owner = await makeUser("pv");
      const target = await makeUser("pt");
      const docId = await createDocument(owner.id, "P", "body");
      vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
      const res = await POST(jsonReq("POST", { email: target.email, role: "REVIEWER" }), ctx(docId));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ ok: true, userId: target.id });
      const row = await prisma.documentParticipant.findUnique({
        where: { documentId_userId: { documentId: docId, userId: target.id } },
      });
      expect(row?.role).toBe("REVIEWER");
    });

    test("invalid role → 400", async () => {
      const owner = await makeUser("pi");
      const target = await makeUser("pit");
      const docId = await createDocument(owner.id, "P", "body");
      vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
      const res = await POST(jsonReq("POST", { email: target.email, role: "ADMIN" }), ctx(docId));
      expect(res.status).toBe(400);
    });

    test("owner shares own email → 400", async () => {
      const owner = await makeUser("pso");
      const docId = await createDocument(owner.id, "P", "body");
      vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
      const res = await POST(jsonReq("POST", { email: owner.email, role: "VIEWER" }), ctx(docId));
      expect(res.status).toBe(400);
    });

    test("owner shares with required: true → 200 + row.required === true", async () => {
      const owner = await makeUser("prq");
      const target = await makeUser("prqt");
      const docId = await createDocument(owner.id, "P", "body");
      vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
      const res = await POST(jsonReq("POST", { email: target.email, role: "REVIEWER", required: true }), ctx(docId));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ ok: true, userId: target.id });
      const row = await prisma.documentParticipant.findUnique({
        where: { documentId_userId: { documentId: docId, userId: target.id } },
      });
      expect(row?.required).toBe(true);
    });

    test("non-owner participant → 403", async () => {
      const owner = await makeUser("pno");
      const other = await makeUser("pnp");
      const target = await makeUser("pnt");
      const docId = await createDocument(owner.id, "P", "body");
      await prisma.documentParticipant.create({ data: { documentId: docId, userId: other.id, role: "REVIEWER" } });
      vi.mocked(api.requireUser).mockResolvedValue({ id: other.id } as never);
      const res = await POST(jsonReq("POST", { email: target.email, role: "VIEWER" }), ctx(docId));
      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /api/documents/[id]/participants/[userId]", () => {
    test("owner changes an existing participant's role → 200 + persisted", async () => {
      const owner = await makeUser("qo");
      const target = await makeUser("qt");
      const docId = await createDocument(owner.id, "P", "body");
      await prisma.documentParticipant.create({ data: { documentId: docId, userId: target.id, role: "VIEWER" } });
      vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
      const res = await PATCH_PARTICIPANT(jsonReq("PATCH", { role: "REVIEWER" }), ctxUser(docId, target.id));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      const row = await prisma.documentParticipant.findUnique({
        where: { documentId_userId: { documentId: docId, userId: target.id } },
      });
      expect(row?.role).toBe("REVIEWER");
    });

    test("invalid role → 400", async () => {
      const owner = await makeUser("qi");
      const target = await makeUser("qit");
      const docId = await createDocument(owner.id, "P", "body");
      await prisma.documentParticipant.create({ data: { documentId: docId, userId: target.id, role: "VIEWER" } });
      vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
      const res = await PATCH_PARTICIPANT(jsonReq("PATCH", { role: "NOPE" }), ctxUser(docId, target.id));
      expect(res.status).toBe(400);
    });

    test("non-participant target → 404", async () => {
      const owner = await makeUser("qn");
      const stranger = await makeUser("qns");
      const docId = await createDocument(owner.id, "P", "body");
      vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
      const res = await PATCH_PARTICIPANT(jsonReq("PATCH", { role: "REVIEWER" }), ctxUser(docId, stranger.id));
      expect(res.status).toBe(404);
    });

    test("non-owner caller → 403", async () => {
      const owner = await makeUser("qo2");
      const other = await makeUser("qo2p");
      const target = await makeUser("qo2t");
      const docId = await createDocument(owner.id, "P", "body");
      await prisma.documentParticipant.create({ data: { documentId: docId, userId: other.id, role: "REVIEWER" } });
      await prisma.documentParticipant.create({ data: { documentId: docId, userId: target.id, role: "VIEWER" } });
      vi.mocked(api.requireUser).mockResolvedValue({ id: other.id } as never);
      const res = await PATCH_PARTICIPANT(jsonReq("PATCH", { role: "REVIEWER" }), ctxUser(docId, target.id));
      expect(res.status).toBe(403);
    });

    test("owner sets required: true on a VIEWER → 400", async () => {
      const owner = await makeUser("qvr");
      const target = await makeUser("qvrt");
      const docId = await createDocument(owner.id, "P", "body");
      await prisma.documentParticipant.create({ data: { documentId: docId, userId: target.id, role: "VIEWER" } });
      vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
      const res = await PATCH_PARTICIPANT(jsonReq("PATCH", { required: true }), ctxUser(docId, target.id));
      expect(res.status).toBe(400);
    });

    test("owner sets required: true on a REVIEWER → 200 + persisted", async () => {
      const owner = await makeUser("qrev");
      const target = await makeUser("qrevt");
      const docId = await createDocument(owner.id, "P", "body");
      await prisma.documentParticipant.create({ data: { documentId: docId, userId: target.id, role: "REVIEWER" } });
      vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
      const res = await PATCH_PARTICIPANT(jsonReq("PATCH", { required: true }), ctxUser(docId, target.id));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      const row = await prisma.documentParticipant.findUnique({
        where: { documentId_userId: { documentId: docId, userId: target.id } },
      });
      expect(row?.required).toBe(true);
    });

    test("owner provides neither role nor required → 400", async () => {
      const owner = await makeUser("qnone");
      const target = await makeUser("qnonet");
      const docId = await createDocument(owner.id, "P", "body");
      await prisma.documentParticipant.create({ data: { documentId: docId, userId: target.id, role: "VIEWER" } });
      vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
      const res = await PATCH_PARTICIPANT(jsonReq("PATCH", {}), ctxUser(docId, target.id));
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/documents/[id]/participants/[userId]", () => {
    test("owner attempts to remove the owner → 400", async () => {
      const owner = await makeUser("do");
      const docId = await createDocument(owner.id, "P", "body");
      vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
      const res = await DELETE(delReq(), ctxUser(docId, owner.id));
      expect(res.status).toBe(400);
    });

    test("owner removes a participant → 200 + row gone", async () => {
      const owner = await makeUser("dp");
      const target = await makeUser("dpt");
      const docId = await createDocument(owner.id, "P", "body");
      await prisma.documentParticipant.create({ data: { documentId: docId, userId: target.id, role: "VIEWER" } });
      vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
      const res = await DELETE(delReq(), ctxUser(docId, target.id));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      const row = await prisma.documentParticipant.findUnique({
        where: { documentId_userId: { documentId: docId, userId: target.id } },
      });
      expect(row).toBeNull();
    });

    test("non-owner caller → 403", async () => {
      const owner = await makeUser("dno");
      const other = await makeUser("dnop");
      const target = await makeUser("dnot");
      const docId = await createDocument(owner.id, "P", "body");
      await prisma.documentParticipant.create({ data: { documentId: docId, userId: other.id, role: "REVIEWER" } });
      await prisma.documentParticipant.create({ data: { documentId: docId, userId: target.id, role: "VIEWER" } });
      vi.mocked(api.requireUser).mockResolvedValue({ id: other.id } as never);
      const res = await DELETE(delReq(), ctxUser(docId, target.id));
      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /api/documents/[id]/settings — visibility", () => {
    test("owner sets visibility → 200 + persisted + no state recompute needed", async () => {
      const owner = await makeUser("vo");
      const docId = await createDocument(owner.id, "P", "body");
      vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
      const before = await prisma.document.findUnique({ where: { id: docId }, select: { visibility: true } });
      expect(before?.visibility).toBe("PRIVATE");
      const res = await PATCH_SETTINGS(jsonReq("PATCH", { visibility: "LINK" }), ctx(docId));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.visibility).toBe("LINK");
      expect(data.state).toBeUndefined();
      const after = await prisma.document.findUnique({ where: { id: docId }, select: { visibility: true } });
      expect(after?.visibility).toBe("LINK");
    });

    test("invalid visibility → 400", async () => {
      const owner = await makeUser("vi");
      const docId = await createDocument(owner.id, "P", "body");
      vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
      const res = await PATCH_SETTINGS(jsonReq("PATCH", { visibility: "PUBLIC" }), ctx(docId));
      expect(res.status).toBe(400);
    });

    test("visibility alongside requiredApprovals → both persisted, state present", async () => {
      const owner = await makeUser("vboth");
      const docId = await createDocument(owner.id, "P", "body");
      vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
      const res = await PATCH_SETTINGS(jsonReq("PATCH", { visibility: "LINK", requiredApprovals: 2 }), ctx(docId));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.visibility).toBe("LINK");
      expect(typeof data.state).toBe("string");
      const doc = await prisma.document.findUnique({ where: { id: docId } });
      expect(doc?.visibility).toBe("LINK");
      expect(doc?.requiredApprovals).toBe(2);
    });
  });
});
