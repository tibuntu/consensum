import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { GET, POST } from "@/app/api/plans/[id]/artifacts/route";
import { createDocument, deleteDocument } from "@/lib/documents";
import { generateToken } from "@/lib/tokens";

let n = 0;
async function makeUser() {
  const now = new Date();
  n++;
  const tag = `${Date.now()}-${n}`;
  return prisma.user.create({
    data: { id: `u-pa-${tag}`, name: "U", email: `u-pa-${tag}@example.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}
function postReq(token: string, body: unknown) {
  return new Request("http://localhost/api/plans/x/artifacts", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function getReq(token: string) {
  return new Request("http://localhost/api/plans/x/artifacts", {
    headers: { authorization: `Bearer ${token}` },
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function makePlan() {
  const owner = await makeUser();
  const { token } = await generateToken(owner.id, "ci", { scopes: "plans:write,feedback:read" });
  const docId = await createDocument(owner.id, "P", "body");
  return { owner, token, docId };
}

afterEach(() => {
  delete process.env.MAX_PLAN_BYTES;
});

describe("POST /api/plans/[id]/artifacts", () => {
  test("owner pushes two artifacts, then overwrites one (latest-wins, pushedAt bumps)", async () => {
    const { token, docId } = await makePlan();
    const res = await POST(
      postReq(token, {
        artifacts: [
          { name: "tasks.json", content: '{"tasks":[]}', gitSha: "abc123" },
          { name: "status.md", content: "tasks 1-4 done" },
        ],
      }),
      ctx(docId),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.artifacts.map((a: { name: string }) => a.name).sort()).toEqual(["status.md", "tasks.json"]);

    const before = await prisma.planArtifact.findUnique({
      where: { documentId_name: { documentId: docId, name: "tasks.json" } },
    });
    expect(before?.gitSha).toBe("abc123");

    await new Promise((r) => setTimeout(r, 5));
    const res2 = await POST(
      postReq(token, { artifacts: [{ name: "tasks.json", content: '{"tasks":[1]}', gitSha: "def456" }] }),
      ctx(docId),
    );
    expect(res2.status).toBe(200);
    const after = await prisma.planArtifact.findUnique({
      where: { documentId_name: { documentId: docId, name: "tasks.json" } },
    });
    expect(after?.content).toBe('{"tasks":[1]}');
    expect(after?.gitSha).toBe("def456");
    expect(after!.pushedAt.getTime()).toBeGreaterThan(before!.pushedAt.getTime());
    expect(await prisma.planArtifact.count({ where: { documentId: docId } })).toBe(2);
    await deleteDocument(docId);
  });

  test("reviewer (non-manager) → 404, matching PATCH precedent", async () => {
    const { docId } = await makePlan();
    const reviewer = await makeUser();
    const { token } = await generateToken(reviewer.id, "ci", { scopes: "plans:write,feedback:read" });
    await prisma.documentParticipant.create({ data: { documentId: docId, userId: reviewer.id, role: "REVIEWER" } });
    const res = await POST(postReq(token, { artifacts: [{ name: "a", content: "x" }] }), ctx(docId));
    expect(res.status).toBe(404);
    await deleteDocument(docId);
  });

  test("missing plans:write scope → 403", async () => {
    const { owner, docId } = await makePlan();
    const { token } = await generateToken(owner.id, "ro", { scopes: "feedback:read" });
    const res = await POST(postReq(token, { artifacts: [{ name: "a", content: "x" }] }), ctx(docId));
    expect(res.status).toBe(403);
    await deleteDocument(docId);
  });

  test("archived → 409", async () => {
    const { token, docId } = await makePlan();
    await prisma.document.update({ where: { id: docId }, data: { archivedAt: new Date() } });
    const res = await POST(postReq(token, { artifacts: [{ name: "a", content: "x" }] }), ctx(docId));
    expect(res.status).toBe(409);
    await deleteDocument(docId);
  });

  test("invalid names → 400 (path traversal, leading dot, empty, too long)", async () => {
    const { token, docId } = await makePlan();
    for (const name of ["../evil", ".hidden", "", "a/b", "a".repeat(101)]) {
      const res = await POST(postReq(token, { artifacts: [{ name, content: "x" }] }), ctx(docId));
      expect(res.status, `name: ${JSON.stringify(name)}`).toBe(400);
    }
    await deleteDocument(docId);
  });

  test("duplicate name within one request → 400", async () => {
    const { token, docId } = await makePlan();
    const res = await POST(
      postReq(token, { artifacts: [{ name: "a", content: "1" }, { name: "a", content: "2" }] }),
      ctx(docId),
    );
    expect(res.status).toBe(400);
    await deleteDocument(docId);
  });

  test("malformed bodies → 400 (no artifacts array, empty array, non-string content, non-string gitSha)", async () => {
    const { token, docId } = await makePlan();
    for (const body of [{}, { artifacts: [] }, { artifacts: [{ name: "a", content: 5 }] }, { artifacts: [{ name: "a", content: "x", gitSha: 5 }] }]) {
      const res = await POST(postReq(token, body), ctx(docId));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    await deleteDocument(docId);
  });

  test("content over maxPlanBytes → 413", async () => {
    process.env.MAX_PLAN_BYTES = "16";
    const { token, docId } = await makePlan();
    const res = await POST(postReq(token, { artifacts: [{ name: "a", content: "x".repeat(17) }] }), ctx(docId));
    expect(res.status).toBe(413);
    await deleteDocument(docId);
  });

  test("resulting count over 10 → 413; re-pushing existing names stays fine", async () => {
    const { token, docId } = await makePlan();
    const ten = Array.from({ length: 10 }, (_, i) => ({ name: `a${i}`, content: "x" }));
    expect((await POST(postReq(token, { artifacts: ten }), ctx(docId))).status).toBe(200);
    expect((await POST(postReq(token, { artifacts: ten }), ctx(docId))).status).toBe(200);
    expect((await POST(postReq(token, { artifacts: [{ name: "a10", content: "x" }] }), ctx(docId))).status).toBe(413);
    await deleteDocument(docId);
  });
});

describe("GET /api/plans/[id]/artifacts", () => {
  test("owner reads all artifacts inline; content round-trips verbatim", async () => {
    const { token, docId } = await makePlan();
    const content = '{"tasks":[{"id":0,"subject":"ümlaut \\"quoted\\""}]}\n';
    await POST(postReq(token, { artifacts: [{ name: "tasks.json", content, gitSha: "abc" }] }), ctx(docId));
    const res = await GET(getReq(token), ctx(docId));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.artifacts).toHaveLength(1);
    expect(data.artifacts[0]).toMatchObject({ name: "tasks.json", content, gitSha: "abc" });
    expect(typeof data.artifacts[0].pushedAt).toBe("string");
    await deleteDocument(docId);
  });

  test("reviewer and VIEWER can read (canView, before claiming)", async () => {
    const { token: ownerToken, docId } = await makePlan();
    await POST(postReq(ownerToken, { artifacts: [{ name: "status.md", content: "wip" }] }), ctx(docId));
    for (const role of ["REVIEWER", "VIEWER"]) {
      const u = await makeUser();
      const { token } = await generateToken(u.id, "ci", { scopes: "feedback:read" });
      await prisma.documentParticipant.create({ data: { documentId: docId, userId: u.id, role } });
      const res = await GET(getReq(token), ctx(docId));
      expect(res.status, role).toBe(200);
      expect((await res.json()).artifacts).toHaveLength(1);
    }
    await deleteDocument(docId);
  });

  test("stranger on LINK doc reads via auto-join", async () => {
    const { token: ownerToken, docId } = await makePlan();
    await POST(postReq(ownerToken, { artifacts: [{ name: "status.md", content: "wip" }] }), ctx(docId));
    await prisma.document.update({ where: { id: docId }, data: { visibility: "LINK" } });
    const stranger = await makeUser();
    const { token } = await generateToken(stranger.id, "ci", { scopes: "feedback:read" });
    const res = await GET(getReq(token), ctx(docId));
    expect(res.status).toBe(200);
    await deleteDocument(docId);
  });

  test("stranger on PRIVATE doc → 404", async () => {
    const { docId } = await makePlan();
    const stranger = await makeUser();
    const { token } = await generateToken(stranger.id, "ci", { scopes: "feedback:read" });
    expect((await GET(getReq(token), ctx(docId))).status).toBe(404);
    await deleteDocument(docId);
  });

  test("missing feedback:read scope → 403", async () => {
    const { owner, docId } = await makePlan();
    const { token } = await generateToken(owner.id, "wo", { scopes: "plans:write" });
    expect((await GET(getReq(token), ctx(docId))).status).toBe(403);
    await deleteDocument(docId);
  });

  test("no artifacts → empty array", async () => {
    const { token, docId } = await makePlan();
    const res = await GET(getReq(token), ctx(docId));
    expect(res.status).toBe(200);
    expect((await res.json()).artifacts).toEqual([]);
    await deleteDocument(docId);
  });
});
