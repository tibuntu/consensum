import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createWebhook, listWebhooks, updateWebhook, deleteWebhook, dispatch } from "@/lib/webhooks";

async function makeUser() {
  const now = new Date();
  const id = `u-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return prisma.user.create({ data: { id, name: "U", email: `${id}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
}
async function makeDoc(ownerId: string) {
  return prisma.document.create({ data: { title: "Doc", ownerId } });
}
async function jobsFor(webhookId: string) {
  const all = await prisma.outboxJob.findMany({ where: { type: "webhook.deliver" } });
  return all.filter((j) => JSON.parse(j.payload).webhookId === webhookId);
}

describe("webhooks service", () => {
  beforeEach(async () => { await prisma.outboxJob.deleteMany({}); });

  it("creates (reveal-once secret), lists without secret", async () => {
    const u = await makeUser();
    const { id, secret } = await createWebhook(u.id, { url: "https://example.com/h", events: ["decision.changed"] });
    expect(secret.startsWith("whsec_")).toBe(true);
    const list = await listWebhooks(u.id);
    const row = list.find((w) => w.id === id)!;
    expect(row.url).toBe("https://example.com/h");
    expect((row as Record<string, unknown>).secretEnc).toBeUndefined();
  });

  it("dispatch enqueues one job per matching active webhook", async () => {
    const u = await makeUser();
    const doc = await makeDoc(u.id);
    const a = await createWebhook(u.id, { url: "https://a.com/h", events: ["decision.changed", "review.updated"] });
    const b = await createWebhook(u.id, { url: "https://b.com/h", events: ["comment.created"] });
    const c = await createWebhook(u.id, { url: "https://c.com/h", events: ["decision.changed"] });
    await updateWebhook(u.id, c.id, { active: false });
    const d = await createWebhook(u.id, { url: "https://d.com/h", events: ["decision.changed"], documentId: "other-doc" });

    await dispatch(doc.id, "decision.changed", { decision: "approved", version: 2 }, u.id);

    expect(await jobsFor(a.id)).toHaveLength(1);
    expect(await jobsFor(b.id)).toHaveLength(0);
    expect(await jobsFor(c.id)).toHaveLength(0);
    expect(await jobsFor(d.id)).toHaveLength(0);
    const [job] = await jobsFor(a.id);
    const payload = JSON.parse(job.payload);
    expect(payload).toMatchObject({ webhookId: a.id, event: "decision.changed", planId: doc.id, decision: "approved", version: 2, actor: "U" });
    expect(typeof payload.occurredAt).toBe("string");
  });

  it("doc-scoped webhook fires only for its document", async () => {
    const u = await makeUser();
    const doc = await makeDoc(u.id);
    const scoped = await createWebhook(u.id, { url: "https://s.com/h", events: ["review.updated"], documentId: doc.id });
    await dispatch(doc.id, "review.updated", { decision: "open" }, u.id);
    expect(await jobsFor(scoped.id)).toHaveLength(1);
  });

  it("update/delete are owner-scoped", async () => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    const { id } = await createWebhook(u1.id, { url: "https://x.com/h", events: ["comment.created"] });
    await updateWebhook(u2.id, id, { active: false });
    expect((await listWebhooks(u1.id)).find((w) => w.id === id)?.active).toBe(true);
    await deleteWebhook(u2.id, id);
    expect((await listWebhooks(u1.id)).find((w) => w.id === id)).toBeTruthy();
    await deleteWebhook(u1.id, id);
    expect((await listWebhooks(u1.id)).find((w) => w.id === id)).toBeUndefined();
  });
});
