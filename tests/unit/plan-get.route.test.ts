import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { GET } from "@/app/api/plans/[id]/route";
import { createDocument, deleteDocument } from "@/lib/documents";
import { generateToken } from "@/lib/tokens";

let n = 0;
async function makeUser() {
  const now = new Date();
  n++;
  const tag = `${Date.now()}-${n}`;
  return prisma.user.create({
    data: { id: `u-pg-${tag}`, name: "U", email: `u-pg-${tag}@example.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}
function getReq(token: string) {
  return new Request("http://localhost/api/plans/x", { headers: { authorization: `Bearer ${token}` } });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/plans/[id]", () => {
  test("owner → 200 with full payload", async () => {
    const owner = await makeUser();
    const { token } = await generateToken(owner.id, "ci", { scopes: "plans:write,feedback:read" });
    const docId = await createDocument(owner.id, "Handover Plan", "# Body", { agentContext: "ticket ABC-1" });
    const res = await GET(getReq(token), ctx(docId));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      id: docId,
      title: "Handover Plan",
      markdown: "# Body",
      versionNumber: 1,
      agentContext: "ticket ABC-1",
      role: "OWNER",
      archived: false,
    });
    expect(typeof data.state).toBe("string");
    await deleteDocument(docId);
  });

  test("REVIEWER participant on PRIVATE doc → 200, role REVIEWER", async () => {
    const owner = await makeUser();
    const reviewer = await makeUser();
    const { token } = await generateToken(reviewer.id, "ci", { scopes: "feedback:read" });
    const docId = await createDocument(owner.id, "P", "body");
    await prisma.documentParticipant.create({ data: { documentId: docId, userId: reviewer.id, role: "REVIEWER" } });
    const res = await GET(getReq(token), ctx(docId));
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe("REVIEWER");
    await deleteDocument(docId);
  });

  test("stranger on PRIVATE doc → 404", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const { token } = await generateToken(stranger.id, "ci", { scopes: "feedback:read" });
    const docId = await createDocument(owner.id, "P", "body");
    expect((await GET(getReq(token), ctx(docId))).status).toBe(404);
    await deleteDocument(docId);
  });

  test("stranger on LINK doc → 200 via auto-join", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const { token } = await generateToken(stranger.id, "ci", { scopes: "feedback:read" });
    const docId = await createDocument(owner.id, "P", "body");
    await prisma.document.update({ where: { id: docId }, data: { visibility: "LINK" } });
    const res = await GET(getReq(token), ctx(docId));
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe("REVIEWER");
    await deleteDocument(docId);
  });

  test("token without feedback:read → 403", async () => {
    const owner = await makeUser();
    const { token } = await generateToken(owner.id, "ci", { scopes: "plans:write" });
    const docId = await createDocument(owner.id, "P", "body");
    expect((await GET(getReq(token), ctx(docId))).status).toBe(403);
    await deleteDocument(docId);
  });

  test("invalid token → 401", async () => {
    expect((await GET(getReq("nope"), ctx("whatever"))).status).toBe(401);
  });
});
