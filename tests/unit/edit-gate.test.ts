import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { PATCH } from "@/app/api/documents/[id]/route";
import { createDocument } from "@/lib/documents";
import * as api from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof api>()), requireUser: vi.fn() }));

async function makeUser(label: string) {
  const now = new Date();
  return prisma.user.create({
    data: { id: `u-${label}-${Date.now()}-${Math.round(Math.random()*1e6)}`, name: "x", email: `u-${label}-${Date.now()}-${Math.round(Math.random()*1e6)}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}
const req = (b: unknown) => new Request("http://t", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("EDIT_UI_ENABLED gates PATCH /api/documents/[id]", () => {
  beforeEach(() => vi.mocked(api.requireUser).mockReset());
  afterEach(() => vi.unstubAllEnvs());

  test("flag off → 403 for the owner", async () => {
    vi.stubEnv("EDIT_UI_ENABLED", "false");
    const owner = await makeUser("e1");
    vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
    const docId = await createDocument(owner.id, "P", "body");
    const res = await PATCH(req({ markdown: "changed", baseVersionNumber: 1 }), ctx(docId));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("EDIT_UI_ENABLED");
  });

  test("flag on (default) → edit succeeds", async () => {
    const owner = await makeUser("e2");
    vi.mocked(api.requireUser).mockResolvedValue({ id: owner.id } as never);
    const docId = await createDocument(owner.id, "P", "body");
    const res = await PATCH(req({ markdown: "changed", baseVersionNumber: 1 }), ctx(docId));
    expect(res.status).toBe(200);
  });
});
