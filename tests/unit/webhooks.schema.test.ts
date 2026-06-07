import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { WEBHOOK_EVENTS } from "@/lib/enums";

async function makeUser() {
  const now = new Date();
  const id = `u-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return prisma.user.create({ data: { id, name: "U", email: `${id}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
}

describe("Webhook schema", () => {
  it("exposes the event value-set", () => {
    expect([...WEBHOOK_EVENTS]).toEqual(["version.created", "review.updated", "decision.changed", "comment.created"]);
  });

  it("persists an owner-scoped webhook", async () => {
    const user = await makeUser();
    const wh = await prisma.webhook.create({
      data: { ownerId: user.id, url: "https://example.com/hook", secretEnc: "v0:abc", events: "decision.changed" },
    });
    expect(wh.active).toBe(true);
    expect(wh.documentId).toBeNull();
    const found = await prisma.webhook.findUnique({ where: { id: wh.id } });
    expect(found?.url).toBe("https://example.com/hook");
  });
});
