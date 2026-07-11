import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));

import { prisma } from "@/lib/db";
import * as api from "@/lib/api";
import { createDocument } from "@/lib/documents";
import { createVersion } from "@/lib/versions";

async function makeUser(label: string) {
  const now = new Date();
  const id = `u-diff-${label}-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return prisma.user.create({
    data: { id, name: "U", email: `${id}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (qs: string) => new Request(`http://t/api/documents/x/diff${qs}`);

describe("GET /api/documents/[id]/diff", () => {
  beforeEach(() => {
    vi.mocked(api.requireUser).mockReset();
  });

  it("gates access and validates version params", async () => {
    const owner = await makeUser("own");
    const stranger = await makeUser("str");
    const id = await createDocument(owner.id, "Doc", "alpha line");
    await createVersion(owner.id, id, 1, "beta line");
    const { GET } = await import("@/app/api/documents/[id]/diff/route");

    vi.mocked(api.requireUser).mockResolvedValueOnce(null as never);
    expect((await GET(req("?from=1&to=2"), ctx(id))).status).toBe(401);

    // WEB docs default PRIVATE — a stranger resolves no access → 404.
    vi.mocked(api.requireUser).mockResolvedValue({ id: stranger.id } as never);
    expect((await GET(req("?from=1&to=2"), ctx(id))).status).toBe(404);

    vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
    expect((await GET(req("?from=abc&to=2"), ctx(id))).status).toBe(400);
    expect((await GET(req("?from=1"), ctx(id))).status).toBe(400);
    expect((await GET(req("?from=1&to=99"), ctx(id))).status).toBe(404);

    await prisma.document.delete({ where: { id } });
  });

  it("returns diff rows between two versions", async () => {
    const owner = await makeUser("rows");
    const id = await createDocument(owner.id, "Doc", "alpha line");
    await createVersion(owner.id, id, 1, "beta line");
    const { GET } = await import("@/app/api/documents/[id]/diff/route");

    vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
    const ok = await GET(req("?from=1&to=2"), ctx(id));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].kind).toBe("changed");
    expect(body.rows[0].oldText).toBe("alpha line");
    expect(body.rows[0].newText).toBe("beta line");

    await prisma.document.delete({ where: { id } });
  });
});
