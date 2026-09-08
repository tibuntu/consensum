import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/plans/route";
import { deleteDocument } from "@/lib/documents";
import { generateToken } from "@/lib/tokens";

let n = 0;
async function makeUser() {
  const now = new Date();
  const tag = `${Date.now()}-${++n}`;
  return prisma.user.create({
    data: { id: `u-pc-${tag}`, name: "U", email: `u-pc-${tag}@example.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

function req(token: string, body: unknown) {
  return new Request("http://localhost/api/plans", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

describe("POST /api/plans — reviewers", () => {
  test("string email + {email, required:true} → 201, participant rows + notifications", async () => {
    const owner = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const { token } = await generateToken(owner.id, "ci", { scopes: "plans:write,feedback:read" });

    const res = await POST(req(token, { title: "T", markdown: "m", reviewers: [a.email, { email: b.email, required: true }] }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.reviewers).toEqual(
      expect.arrayContaining([
        { email: a.email.toLowerCase(), status: "added" },
        { email: b.email.toLowerCase(), status: "added" },
      ]),
    );

    const partA = await prisma.documentParticipant.findUnique({ where: { documentId_userId: { documentId: data.id, userId: a.id } } });
    expect(partA?.role).toBe("REVIEWER");
    expect(partA?.required).toBe(false);
    const partB = await prisma.documentParticipant.findUnique({ where: { documentId_userId: { documentId: data.id, userId: b.id } } });
    expect(partB?.role).toBe("REVIEWER");
    expect(partB?.required).toBe(true);

    const notifA = await prisma.notification.findFirst({ where: { documentId: data.id, userId: a.id } });
    expect(notifA?.type).toBe("shared");
    const notifB = await prisma.notification.findFirst({ where: { documentId: data.id, userId: b.id } });
    expect(notifB?.type).toBe("review_requested");

    await deleteDocument(data.id);
  });

  test("unknown email → 201, reviewers[] reports no_account", async () => {
    const owner = await makeUser();
    const { token } = await generateToken(owner.id, "ci", { scopes: "plans:write,feedback:read" });
    const res = await POST(req(token, { title: "T", markdown: "m", reviewers: ["nobody-here@example.com"] }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.reviewers).toEqual([{ email: "nobody-here@example.com", status: "no_account" }]);
    await deleteDocument(data.id);
  });

  test("owner's own email → cannot_share_owner", async () => {
    const owner = await makeUser();
    const { token } = await generateToken(owner.id, "ci", { scopes: "plans:write,feedback:read" });
    const res = await POST(req(token, { title: "T", markdown: "m", reviewers: [owner.email] }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.reviewers).toEqual([{ email: owner.email.toLowerCase(), status: "cannot_share_owner" }]);
    await deleteDocument(data.id);
  });

  test("reviewers not an array → 400, no document created", async () => {
    const owner = await makeUser();
    const { token } = await generateToken(owner.id, "ci", { scopes: "plans:write,feedback:read" });
    const before = await prisma.document.count({ where: { ownerId: owner.id } });
    const res = await POST(req(token, { title: "T", markdown: "m", reviewers: "nope" }));
    expect(res.status).toBe(400);
    const after = await prisma.document.count({ where: { ownerId: owner.id } });
    expect(after).toBe(before);
  });
});

describe("POST /api/plans — tags", () => {
  test("mixed-case/whitespace tags → 201, normalized, DocumentTag rows exist", async () => {
    const owner = await makeUser();
    const { token } = await generateToken(owner.id, "ci", { scopes: "plans:write,feedback:read" });
    const res = await POST(req(token, { title: "T", markdown: "m", tags: ["Infra", " security "] }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.tags).toEqual(["infra", "security"]);

    const rows = await prisma.documentTag.findMany({ where: { documentId: data.id }, include: { tag: true } });
    expect(rows.map((r) => r.tag.name).sort()).toEqual(["infra", "security"]);

    await deleteDocument(data.id);
  });

  test("empty-string tag → 400, no document created", async () => {
    const owner = await makeUser();
    const { token } = await generateToken(owner.id, "ci", { scopes: "plans:write,feedback:read" });
    const before = await prisma.document.count({ where: { ownerId: owner.id } });
    const res = await POST(req(token, { title: "T", markdown: "m", tags: [""] }));
    expect(res.status).toBe(400);
    const after = await prisma.document.count({ where: { ownerId: owner.id } });
    expect(after).toBe(before);
  });
});
