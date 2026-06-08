import { describe, expect, test, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { PATCH } from "@/app/api/settings/notifications/route";
import * as api from "@/lib/api";

vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));

async function makeUser(label: string) {
  const now = new Date();
  return prisma.user.create({
    data: {
      id: `u-${label}-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      name: "x",
      email: `u-${label}-${Date.now()}-${Math.round(Math.random() * 1e6)}@ex.com`,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    },
  });
}
const req = (b: unknown) =>
  new Request("http://t", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

describe("PATCH /api/settings/notifications", () => {
  beforeEach(() => {
    vi.mocked(api.requireUser).mockReset();
  });

  test("updates desktopNotifications", async () => {
    const u = await makeUser("a");
    vi.mocked(api.requireUser).mockResolvedValue({ id: u.id } as never);
    const res = await PATCH(req({ desktopNotifications: true }));
    expect(res.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: u.id } }))?.desktopNotifications).toBe(true);
  });

  test("updates emailNotifications only when provided", async () => {
    const u = await makeUser("c");
    vi.mocked(api.requireUser).mockResolvedValue({ id: u.id } as never);
    const res = await PATCH(req({ emailNotifications: false }));
    expect(res.status).toBe(200);
    const row = await prisma.user.findUnique({ where: { id: u.id } });
    expect(row?.emailNotifications).toBe(false);
    expect(row?.desktopNotifications).toBe(false); // untouched default
  });

  test("400 when neither field provided", async () => {
    const u = await makeUser("b");
    vi.mocked(api.requireUser).mockResolvedValue({ id: u.id } as never);
    expect((await PATCH(req({}))).status).toBe(400);
  });
});
