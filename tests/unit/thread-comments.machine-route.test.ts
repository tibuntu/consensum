import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/plans/[id]/threads/[threadId]/comments/route";
import { createDocument, deleteDocument, setArchived } from "@/lib/documents";
import { createAnnotation } from "@/lib/annotations";
import { buildQuote } from "@/lib/anchoring";
import { generateToken } from "@/lib/tokens";

let n = 0;
async function makeUser() {
  const now = new Date();
  const tag = `${Date.now()}-${++n}`;
  return prisma.user.create({
    data: { id: `u-tc-${tag}`, name: "U", email: `u-tc-${tag}@example.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

const req = (token: string, body: unknown) =>
  new Request("http://localhost/api/plans/x/threads/y/comments", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
const ctx = (id: string, threadId: string) => ({ params: Promise.resolve({ id, threadId }) });

describe("POST /api/plans/[id]/threads/[threadId]/comments", () => {
  test("stranger → 404; scope-less → 403; wrong-plan thread → 404; bad body → 400/413; valid → 201; archived → 409", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const md = "The cloud setup needs review.";
    const docId = await createDocument(owner.id, "P", md);
    const start = md.indexOf("cloud setup");
    const ann = await createAnnotation(
      owner.id,
      docId,
      { quote: buildQuote(md, start, start + "cloud setup".length), startOffset: start, endOffset: start + 11 },
      "infra concern"
    );

    const { token: strangerToken } = await generateToken(stranger.id, "ci", { scopes: "plans:write,feedback:read" });
    expect((await POST(req(strangerToken, { body: "reply" }), ctx(docId, ann.id))).status).toBe(404);

    const { token: readonly } = await generateToken(owner.id, "ro", { scopes: "feedback:read" });
    expect((await POST(req(readonly, { body: "reply" }), ctx(docId, ann.id))).status).toBe(403);

    const { token } = await generateToken(owner.id, "ci", { scopes: "plans:write,feedback:read" });

    // thread belongs to a different plan than the one named in the URL
    const otherDocId = await createDocument(owner.id, "Other", "Other body");
    expect((await POST(req(token, { body: "reply" }), ctx(otherDocId, ann.id))).status).toBe(404);
    await deleteDocument(otherDocId);

    expect((await POST(req(token, {}), ctx(docId, ann.id))).status).toBe(400);
    expect((await POST(req(token, { body: "   " }), ctx(docId, ann.id))).status).toBe(400);
    expect((await POST(req(token, { body: "x".repeat(20001) }), ctx(docId, ann.id))).status).toBe(413);

    const ok = await POST(req(token, { body: "Addressed in v2: fixed it" }), ctx(docId, ann.id));
    expect(ok.status).toBe(201);
    const { comment } = await ok.json();
    expect(comment.body).toBe("Addressed in v2: fixed it");
    const row = await prisma.comment.findUnique({ where: { id: comment.id } });
    expect(row?.authorId).toBe(owner.id);

    await setArchived(docId, true);
    expect((await POST(req(token, { body: "another" }), ctx(docId, ann.id))).status).toBe(409);

    await deleteDocument(docId);
  });
});
