import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createWebhook, signBody, deliverWebhook, onDeadWebhook } from "@/lib/webhooks";

async function makeUser() {
  const now = new Date();
  const id = `u-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return prisma.user.create({ data: { id, name: "U", email: `${id}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
}

describe("webhook delivery", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("signBody is a deterministic sha256 HMAC", () => {
    const sig = signBody("whsec_fixed", '{"a":1}');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signBody("whsec_fixed", '{"a":1}')).toBe(sig);
    expect(signBody("whsec_other", '{"a":1}')).not.toBe(sig);
  });

  it("delivers, signs, and records 200", async () => {
    const u = await makeUser();
    const { id, secret } = await createWebhook(u.id, { url: "https://example.com/h", events: ["decision.changed"] });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));

    await deliverWebhook({ webhookId: id, event: "decision.changed", planId: "doc1", occurredAt: "t", decision: "approved" });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init!.headers as Record<string, string>;
    expect(headers["X-Quorum-Event"]).toBe("decision.changed");
    expect(headers["X-Quorum-Signature"]).toBe(signBody(secret, init!.body as string));
    expect(headers["X-Quorum-Timestamp"]).toBeTruthy();
    const row = await prisma.webhook.findUnique({ where: { id } });
    expect(row?.lastStatus).toBe("200");
    expect(row?.lastDeliveredAt).toBeTruthy();
  });

  it("throws on non-2xx and records the status", async () => {
    const u = await makeUser();
    const { id } = await createWebhook(u.id, { url: "https://example.com/h", events: ["decision.changed"] });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(deliverWebhook({ webhookId: id, event: "decision.changed", planId: "d", occurredAt: "t" })).rejects.toThrow(/500/);
    expect((await prisma.webhook.findUnique({ where: { id } }))?.lastStatus).toBe("500");
  });

  it("onDeadWebhook marks the webhook DEAD", async () => {
    const u = await makeUser();
    const { id } = await createWebhook(u.id, { url: "https://example.com/h", events: ["decision.changed"] });
    await onDeadWebhook({ webhookId: id }, "exhausted: 500");
    const row = await prisma.webhook.findUnique({ where: { id } });
    expect(row?.lastStatus).toBe("DEAD");
    expect(row?.lastError).toMatch(/exhausted/);
  });
});
