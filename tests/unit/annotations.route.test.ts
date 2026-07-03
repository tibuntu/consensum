import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));

import { prisma } from "@/lib/db";
import * as api from "@/lib/api";
import { createDocument } from "@/lib/documents";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (payload: unknown) =>
  new Request("http://t", { method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json" } });

describe("POST /api/documents/[id]/annotations — scope validation", () => {
  it("creates document-scoped threads and rejects invalid scope combinations", async () => {
    const now = new Date();
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const user = await prisma.user.create({
      data: { id: `rt-${suffix}`, name: "R", email: `rt-${suffix}@e.com`, emailVerified: false, createdAt: now, updatedAt: now },
    });
    const id = await createDocument(user.id, "Plan", "The cloud setup needs review.");
    const { POST } = await import("@/app/api/documents/[id]/annotations/route");
    vi.mocked(api.requireUser).mockResolvedValue({ id: user.id } as never);

    const ok = await POST(post({ body: "overall: needs a rollback section", scope: "document", severity: "BLOCKER" }), ctx(id));
    expect(ok.status).toBe(201);
    const { annotation } = await ok.json();
    expect(annotation.scope).toBe("DOCUMENT");
    expect(annotation.anchorExact).toBeNull();
    expect(annotation.severity).toBe("BLOCKER");

    expect((await POST(post({ body: "x", scope: "document", startOffset: 0 }), ctx(id))).status).toBe(400);
    expect((await POST(post({ body: "x", scope: "document", kind: "SUGGESTION" }), ctx(id))).status).toBe(400);
    expect((await POST(post({ body: "x", scope: "bogus" }), ctx(id))).status).toBe(400);
    expect((await POST(post({ body: "x" }), ctx(id))).status).toBe(400);

    const inline = await POST(
      post({ body: "inline still works", scope: "inline", quote: { exact: "cloud setup", prefix: "The ", suffix: " needs" }, startOffset: 4, endOffset: 15 }),
      ctx(id)
    );
    expect(inline.status).toBe(201);

    await prisma.document.delete({ where: { id } });
  });
});
