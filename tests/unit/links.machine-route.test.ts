import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/plans/[id]/links/route";
import { createDocument, deleteDocument } from "@/lib/documents";
import { generateToken } from "@/lib/tokens";

let n = 0;
async function makeUser() {
  const now = new Date();
  const tag = `${Date.now()}-${++n}`;
  return prisma.user.create({
    data: { id: `u-lm-${tag}`, name: "U", email: `u-lm-${tag}@example.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}
const req = (token: string, body: unknown) =>
  new Request("http://localhost/api/plans/x/links", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/plans/[id]/links", () => {
  test("stranger token → 404; scope-less token → 403; bad body → 400; valid → 201", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const docId = await createDocument(owner.id, "P", "body");

    const { token: strangerToken } = await generateToken(stranger.id, "ci", { scopes: "plans:write,feedback:read" });
    expect((await POST(req(strangerToken, { url: "https://example.com/pr/1" }), ctx(docId))).status).toBe(404);

    const { token: readonly } = await generateToken(owner.id, "ro", { scopes: "feedback:read" });
    expect((await POST(req(readonly, { url: "https://example.com/pr/1" }), ctx(docId))).status).toBe(403);

    const { token } = await generateToken(owner.id, "ci", { scopes: "plans:write,feedback:read" });
    expect((await POST(req(token, {}), ctx(docId))).status).toBe(400);
    expect((await POST(req(token, { url: "not a url" }), ctx(docId))).status).toBe(400);

    const ok = await POST(req(token, { url: "https://example.com/pr/1", label: "PR #1", kind: "pr" }), ctx(docId));
    expect(ok.status).toBe(201);
    const { link } = await ok.json();
    expect(link.kind).toBe("pr");
    expect(link.label).toBe("PR #1");

    await deleteDocument(docId);
  });
});
