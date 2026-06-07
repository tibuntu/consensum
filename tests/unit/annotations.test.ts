import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { createAnnotation, addComment, setThreadStatus } from "@/lib/annotations";
import { buildQuote } from "@/lib/anchoring";
import { SEVERITIES } from "@/lib/enums";

describe("annotations service", () => {
  it("creates, replies, resolves", async () => {
    const now = new Date();
    const user = await prisma.user.create({ data: { id: `u-${Date.now()}`, name: "U", email: `u-${Date.now()}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
    const md = "The cloud setup needs review.";
    const docId = await createDocument(user.id, "Plan", md);
    const start = md.indexOf("cloud setup");
    const ann = await createAnnotation(user.id, docId, { quote: buildQuote(md, start, start + "cloud setup".length), startOffset: start, endOffset: start + 11 }, "infra concern");
    await addComment(user.id, ann.id, "agree");
    await setThreadStatus(user.id, ann.id, "RESOLVED");
    const loaded = await prisma.annotation.findUnique({ where: { id: ann.id }, include: { comments: true } });
    expect(loaded?.comments).toHaveLength(2);
    expect(loaded?.threadStatus).toBe("RESOLVED");
    await prisma.document.delete({ where: { id: docId } });
  });

  it("persists severity and category when provided", async () => {
    const now = new Date();
    const user = await prisma.user.create({ data: { id: `u-${Date.now()}-sev`, name: "U", email: `u-${Date.now()}-sev@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
    const md = "The cloud setup needs review.";
    const docId = await createDocument(user.id, "Plan", md);
    const start = md.indexOf("cloud setup");
    const ann = await createAnnotation(
      user.id,
      docId,
      { quote: buildQuote(md, start, start + "cloud setup".length), startOffset: start, endOffset: start + 11, severity: "BLOCKER", category: "security" },
      "infra concern"
    );
    const loaded = await prisma.annotation.findUnique({ where: { id: ann.id } });
    expect(loaded?.severity).toBe("BLOCKER");
    expect(loaded?.category).toBe("security");
    await prisma.document.delete({ where: { id: docId } });
  });

  it("defaults severity and category to null", async () => {
    const now = new Date();
    const user = await prisma.user.create({ data: { id: `u-${Date.now()}-nul`, name: "U", email: `u-${Date.now()}-nul@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
    const md = "The cloud setup needs review.";
    const docId = await createDocument(user.id, "Plan", md);
    const start = md.indexOf("cloud setup");
    const ann = await createAnnotation(user.id, docId, { quote: buildQuote(md, start, start + 11), startOffset: start, endOffset: start + 11 }, "x");
    const loaded = await prisma.annotation.findUnique({ where: { id: ann.id } });
    expect(loaded?.severity).toBeNull();
    expect(loaded?.category).toBeNull();
    await prisma.document.delete({ where: { id: docId } });
  });

  it("SEVERITIES is the canonical set", () => {
    expect([...SEVERITIES]).toEqual(["BLOCKER", "MAJOR", "MINOR", "NIT"]);
  });
});
