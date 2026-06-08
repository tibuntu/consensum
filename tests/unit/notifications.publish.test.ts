import { describe, expect, test, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { notifyParticipants, markRead, markAllRead } from "@/lib/notifications";
import { subscribe, type DocEvent } from "@/lib/events";

vi.mock("@/lib/email-digest", () => ({ enqueueEmailEvent: vi.fn() }));

async function makeUser(label: string) {
  const now = new Date();
  return prisma.user.create({
    data: {
      id: `u-${label}-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      name: label,
      email: `u-${label}-${Date.now()}-${Math.round(Math.random() * 1e6)}@ex.com`,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    },
  });
}

describe("notification publishing", () => {
  beforeEach(async () => {
    await prisma.notification.deleteMany();
  });

  test("notifyParticipants publishes notification.created to each recipient", async () => {
    const owner = await makeUser("owner");
    const reviewer = await makeUser("rev");
    const id = await createDocument(owner.id, "Plan", "# hi");
    await prisma.documentParticipant.create({ data: { documentId: id, userId: reviewer.id } });

    const events: DocEvent[] = [];
    const off = subscribe(`user-${reviewer.id}`, (e) => events.push(e));
    await notifyParticipants(id, owner.id, "comment"); // actor=owner → reviewer is the recipient
    off();

    expect(events.length).toBe(1);
    const e = events[0];
    expect(e.type).toBe("notification.created");
    if (e.type !== "notification.created") throw new Error("expected notification.created");
    expect(e.notification).toMatchObject({ documentId: id, documentTitle: "Plan", type: "comment", read: false });
    expect(typeof e.notification.id).toBe("string");
    expect(typeof e.notification.createdAt).toBe("string");

    await prisma.document.delete({ where: { id } });
  });

  test("markRead publishes notification.read with the id", async () => {
    const user = await makeUser("u");
    const other = await makeUser("o");
    const id = await createDocument(other.id, "Plan", "# hi");
    await prisma.documentParticipant.create({ data: { documentId: id, userId: user.id } });
    await notifyParticipants(id, other.id, "comment");
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: user.id } });

    const events: DocEvent[] = [];
    const off = subscribe(`user-${user.id}`, (e) => events.push(e));
    await markRead(user.id, row.id);
    off();

    expect(events).toEqual([{ type: "notification.read", id: row.id }]);

    await prisma.document.delete({ where: { id } });
  });

  test("markAllRead publishes notification.read.all", async () => {
    const user = await makeUser("u2");

    const events: DocEvent[] = [];
    const off = subscribe(`user-${user.id}`, (e) => events.push(e));
    await markAllRead(user.id);
    off();

    expect(events).toEqual([{ type: "notification.read.all" }]);
  });
});
