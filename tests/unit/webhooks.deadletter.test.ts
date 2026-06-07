import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createWebhook, registerWebhookHandler } from "@/lib/webhooks";
import { enqueue, tick, __resetHandlers } from "@/lib/outbox";

async function makeUser() {
  const now = new Date();
  const id = `u-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return prisma.user.create({ data: { id, name: "U", email: `${id}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
}

describe("webhook dead-letter", () => {
  beforeEach(async () => { __resetHandlers(); await prisma.outboxJob.deleteMany({}); });

  it("retries a 500 endpoint to exhaustion → DEAD on job and webhook", async () => {
    process.env.OUTBOX_BACKOFF_MS = "0";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("err", { status: 500 }));
    registerWebhookHandler();
    const u = await makeUser();
    const { id } = await createWebhook(u.id, { url: "https://example.com/h", events: ["decision.changed"] });
    const jobId = await enqueue("webhook.deliver", { webhookId: id, event: "decision.changed", planId: "d", occurredAt: "t" });
    await prisma.outboxJob.update({ where: { id: jobId }, data: { maxAttempts: 2 } });

    await tick(); // attempt 1 -> PENDING (retried)
    await tick(); // attempt 2 -> DEAD + onDead

    expect((await prisma.outboxJob.findUnique({ where: { id: jobId } }))?.status).toBe("DEAD");
    expect((await prisma.webhook.findUnique({ where: { id } }))?.lastStatus).toBe("DEAD");
    delete process.env.OUTBOX_BACKOFF_MS;
    vi.restoreAllMocks();
  });
});
