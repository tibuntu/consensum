import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { PATCH } from "@/app/api/plans/[id]/settings/route";
import { POST } from "@/app/api/plans/route";
import { createDocument, deleteDocument } from "@/lib/documents";
import { generateToken } from "@/lib/tokens";

let n = 0;
async function makeUser() {
  const now = new Date();
  n++;
  const tag = `${Date.now()}-${n}`;
  return prisma.user.create({
    data: { id: `u-ps-${tag}`, name: "U", email: `u-ps-${tag}@example.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

function patchReq(token: string, body: unknown) {
  return new Request("http://localhost/api/plans/x/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}
function planReq(token: string, body: unknown) {
  return new Request("http://localhost/api/plans", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("PATCH /api/plans/[id]/settings — requireBlockerResolution", () => {
  test("owner token enables the gate → 200 + persisted + state, no ok field", async () => {
    const owner = await makeUser();
    const { token } = await generateToken(owner.id, "ci", { scopes: "plans:write,feedback:read" });
    const docId = await createDocument(owner.id, "P", "body");
    const res = await PATCH(patchReq(token, { requireBlockerResolution: true }), ctx(docId));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.requireBlockerResolution).toBe(true);
    expect(typeof data.state).toBe("string");
    expect(data.ok).toBeUndefined();
    expect((await prisma.document.findUnique({ where: { id: docId } }))?.requireBlockerResolution).toBe(true);
    await deleteDocument(docId);
  });

  test("token lacking plans:write scope → 403", async () => {
    const owner = await makeUser();
    const { token } = await generateToken(owner.id, "readonly", { scopes: "feedback:read" });
    const docId = await createDocument(owner.id, "P", "body");
    expect((await PATCH(patchReq(token, { requireBlockerResolution: true }), ctx(docId))).status).toBe(403);
    await deleteDocument(docId);
  });

  test("non-boolean gate → 400", async () => {
    const owner = await makeUser();
    const { token } = await generateToken(owner.id, "ci", { scopes: "plans:write,feedback:read" });
    const docId = await createDocument(owner.id, "P", "body");
    expect((await PATCH(patchReq(token, { requireBlockerResolution: "yes" }), ctx(docId))).status).toBe(400);
    await deleteDocument(docId);
  });
});

describe("POST /api/plans — requireBlockerResolution", () => {
  test("non-boolean gate → 400", async () => {
    const owner = await makeUser();
    const { token } = await generateToken(owner.id, "ci", { scopes: "plans:write,feedback:read" });
    const res = await POST(planReq(token, { title: "P", markdown: "# P", requireBlockerResolution: "yes" }));
    expect(res.status).toBe(400);
  });

  test("boolean true → 201 + persisted on the created document", async () => {
    const owner = await makeUser();
    const { token } = await generateToken(owner.id, "ci", { scopes: "plans:write,feedback:read" });
    const res = await POST(planReq(token, { title: "P", markdown: "# P", requireBlockerResolution: true }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect((await prisma.document.findUnique({ where: { id } }))?.requireBlockerResolution).toBe(true);
    await deleteDocument(id);
  });
});
