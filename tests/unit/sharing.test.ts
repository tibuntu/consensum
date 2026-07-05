import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { submitReview } from "@/lib/reviews";
import {
  listParticipants,
  shareWith,
  setRole,
  removeParticipant,
  setVisibility,
} from "@/lib/sharing";

let userSeq = 0;
async function makeUser(label: string) {
  const now = new Date();
  const id = `u-${label}-${Date.now()}-${++userSeq}-${Math.round(Math.random() * 1e6)}`;
  return prisma.user.create({
    data: { id, name: `Name-${label}`, email: `${id}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now },
  });
}

describe("lib/sharing", () => {
  describe("shareWith", () => {
    it("returns no_account for an email with no matching user", async () => {
      const owner = await makeUser("o1");
      const docId = await createDocument(owner.id, "Plan", "body");

      const result = await shareWith(owner.id, docId, "nobody@nowhere.com", "REVIEWER");
      expect(result).toEqual({ error: "no_account" });

      await prisma.document.delete({ where: { id: docId } });
    });

    it("returns cannot_share_owner for the owner's own email", async () => {
      const owner = await makeUser("o2");
      const docId = await createDocument(owner.id, "Plan", "body");

      const result = await shareWith(owner.id, docId, owner.email, "REVIEWER");
      expect(result).toEqual({ error: "cannot_share_owner" });

      await prisma.document.delete({ where: { id: docId } });
    });

    it("adds a participant with the given role", async () => {
      const owner = await makeUser("o3");
      const target = await makeUser("t3");
      const docId = await createDocument(owner.id, "Plan", "body");

      const result = await shareWith(owner.id, docId, target.email, "VIEWER");
      expect(result).toEqual({ ok: true, userId: target.id });

      const row = await prisma.documentParticipant.findUnique({
        where: { documentId_userId: { documentId: docId, userId: target.id } },
      });
      expect(row?.role).toBe("VIEWER");

      await prisma.document.delete({ where: { id: docId } });
    });

    it("is idempotent: re-sharing updates the role and does not create a second notification", async () => {
      const owner = await makeUser("o4");
      const target = await makeUser("t4");
      const docId = await createDocument(owner.id, "Plan", "body");

      const first = await shareWith(owner.id, docId, target.email, "VIEWER");
      expect(first).toEqual({ ok: true, userId: target.id });

      const second = await shareWith(owner.id, docId, target.email, "REVIEWER");
      expect(second).toEqual({ ok: true, userId: target.id });

      const row = await prisma.documentParticipant.findUnique({
        where: { documentId_userId: { documentId: docId, userId: target.id } },
      });
      expect(row?.role).toBe("REVIEWER");

      const notificationCount = await prisma.notification.count({
        where: { userId: target.id, documentId: docId, type: "shared" },
      });
      expect(notificationCount).toBe(1);

      await prisma.document.delete({ where: { id: docId } });
    });
  });

  describe("setRole", () => {
    it("flips an existing participant's role VIEWER -> REVIEWER", async () => {
      const owner = await makeUser("o5");
      const target = await makeUser("t5");
      const docId = await createDocument(owner.id, "Plan", "body");
      await prisma.documentParticipant.create({ data: { documentId: docId, userId: target.id, role: "VIEWER" } });

      const result = await setRole(docId, target.id, "REVIEWER");
      expect(result).toEqual({ ok: true });

      const row = await prisma.documentParticipant.findUnique({
        where: { documentId_userId: { documentId: docId, userId: target.id } },
      });
      expect(row?.role).toBe("REVIEWER");

      const back = await setRole(docId, target.id, "VIEWER");
      expect(back).toEqual({ ok: true });
      const row2 = await prisma.documentParticipant.findUnique({
        where: { documentId_userId: { documentId: docId, userId: target.id } },
      });
      expect(row2?.role).toBe("VIEWER");

      await prisma.document.delete({ where: { id: docId } });
    });

    it("returns not_participant for a user with no participant row", async () => {
      const owner = await makeUser("o6");
      const stranger = await makeUser("s6");
      const docId = await createDocument(owner.id, "Plan", "body");

      const result = await setRole(docId, stranger.id, "REVIEWER");
      expect(result).toEqual({ error: "not_participant" });

      await prisma.document.delete({ where: { id: docId } });
    });
  });

  describe("removeParticipant", () => {
    it("deletes the participant row, dismisses their reviews, and recomputes state away from APPROVED", async () => {
      const owner = await makeUser("o7");
      const reviewer = await makeUser("r7");
      const docId = await createDocument(owner.id, "Plan", "body");
      await prisma.documentParticipant.create({ data: { documentId: docId, userId: reviewer.id, role: "REVIEWER" } });

      await submitReview(reviewer.id, docId, "APPROVE");
      const approved = await prisma.document.findUnique({ where: { id: docId }, select: { state: true } });
      expect(approved?.state).toBe("APPROVED");

      const result = await removeParticipant(owner.id, docId, reviewer.id);
      expect(result).toEqual({ ok: true });

      const row = await prisma.documentParticipant.findUnique({
        where: { documentId_userId: { documentId: docId, userId: reviewer.id } },
      });
      expect(row).toBeNull();

      const reviews = await prisma.review.findMany({ where: { documentId: docId, reviewerId: reviewer.id } });
      expect(reviews.length).toBeGreaterThan(0);
      expect(reviews.every((r) => r.dismissed)).toBe(true);

      const after = await prisma.document.findUnique({ where: { id: docId }, select: { state: true } });
      expect(after?.state).not.toBe("APPROVED");

      await prisma.document.delete({ where: { id: docId } });
    });

    it("returns cannot_remove_owner for the owner's id", async () => {
      const owner = await makeUser("o8");
      const docId = await createDocument(owner.id, "Plan", "body");

      const result = await removeParticipant(owner.id, docId, owner.id);
      expect(result).toEqual({ error: "cannot_remove_owner" });

      await prisma.document.delete({ where: { id: docId } });
    });
  });

  describe("setVisibility", () => {
    it("flips PRIVATE to LINK without touching participant rows", async () => {
      const owner = await makeUser("o9");
      const reviewer = await makeUser("r9");
      const docId = await createDocument(owner.id, "Plan", "body");
      await prisma.documentParticipant.create({ data: { documentId: docId, userId: reviewer.id, role: "REVIEWER" } });

      const before = await prisma.document.findUnique({ where: { id: docId }, select: { visibility: true } });
      expect(before?.visibility).toBe("PRIVATE");

      await setVisibility(docId, "LINK");

      const after = await prisma.document.findUnique({ where: { id: docId }, select: { visibility: true } });
      expect(after?.visibility).toBe("LINK");

      const row = await prisma.documentParticipant.findUnique({
        where: { documentId_userId: { documentId: docId, userId: reviewer.id } },
      });
      expect(row).not.toBeNull();

      await prisma.document.delete({ where: { id: docId } });
    });
  });

  describe("listParticipants", () => {
    it("returns the owner flagged isOwner:true followed by participants, owner not duplicated", async () => {
      const owner = await makeUser("o10");
      const reviewer = await makeUser("r10");
      const docId = await createDocument(owner.id, "Plan", "body");
      await prisma.documentParticipant.create({ data: { documentId: docId, userId: reviewer.id, role: "REVIEWER" } });

      const rows = await listParticipants(docId);

      const ownerRows = rows.filter((r) => r.userId === owner.id);
      expect(ownerRows).toHaveLength(1);
      expect(ownerRows[0]).toMatchObject({ userId: owner.id, email: owner.email, isOwner: true });

      const reviewerRow = rows.find((r) => r.userId === reviewer.id);
      expect(reviewerRow).toMatchObject({ userId: reviewer.id, email: reviewer.email, role: "REVIEWER", isOwner: false });

      await prisma.document.delete({ where: { id: docId } });
    });
  });
});
