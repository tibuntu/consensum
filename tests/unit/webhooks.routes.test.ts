import { describe, it, expect, vi, beforeEach } from "vitest";

const user = { id: "owner-1" };
vi.mock("@/lib/api", () => ({ requireUser: vi.fn(async () => user) }));

import { prisma } from "@/lib/db";
import * as api from "@/lib/api";

async function ensureUser() {
  const now = new Date();
  await prisma.user.upsert({ where: { id: user.id }, update: {}, create: { id: user.id, name: "Owner", email: `${user.id}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
}

describe("/api/webhooks", () => {
  beforeEach(async () => { vi.mocked(api.requireUser).mockResolvedValue(user as never); await ensureUser(); await prisma.webhook.deleteMany({ where: { ownerId: user.id } }); });

  it("401 without a session", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce(null as never);
    const { POST } = await import("@/app/api/webhooks/route");
    const res = await POST(new Request("http://t/api/webhooks", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });

  it("creates and lists (no secret in list)", async () => {
    const { POST, GET } = await import("@/app/api/webhooks/route");
    const res = await POST(new Request("http://t/api/webhooks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com/h", events: ["decision.changed"] }) }));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.secret.startsWith("whsec_")).toBe(true);

    const list = await (await GET()).json();
    expect(list.webhooks[0].url).toBe("https://example.com/h");
    expect(list.webhooks[0].secretEnc).toBeUndefined();
  });

  it("400 on invalid url / bad events", async () => {
    const { POST } = await import("@/app/api/webhooks/route");
    const bad = await POST(new Request("http://t", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "not-a-url", events: ["decision.changed"] }) }));
    expect(bad.status).toBe(400);
    const noEvents = await POST(new Request("http://t", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com/h", events: [] }) }));
    expect(noEvents.status).toBe(400);
  });
});
