import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiUser } from "@/lib/api";
import { resolveAccess } from "@/lib/authz";
import { notifyOwnershipClaimed } from "@/lib/notifications";
import { recomputeStateAndDispatch } from "@/lib/reviews";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authd = await requireApiUser(req);
  if (!authd.ok) return authd.response;
  const { id } = await params;
  const access = await resolveAccess(authd.user.id, id);
  if (!access) return NextResponse.json({ error: "not found" }, { status: 404, headers: authd.headers });
  if (!authd.scopes.includes("plans:write")) return NextResponse.json({ error: "insufficient scope" }, { status: 403, headers: authd.headers });
  if (access.role === "OWNER") return NextResponse.json({ error: "already owner" }, { status: 409, headers: authd.headers });
  if (access.role !== "REVIEWER") return NextResponse.json({ error: "reviewers only" }, { status: 403, headers: authd.headers });
  if (access.archived) return NextResponse.json({ error: "document is archived" }, { status: 409, headers: authd.headers });

  const doc = await prisma.document.findUnique({
    where: { id },
    select: { ownerId: true, currentVersion: { select: { versionNumber: true } } },
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404, headers: authd.headers });

  const previousOwnerId = doc.ownerId;
  const claimed = await prisma.$transaction(async (tx) => {
    // Guard on the owner we read (+archivedAt: null) — a concurrent claim or
    // archive that won first makes this a no-op. idempotencyKey belongs to the
    // previous owner's client namespace ( @@unique([ownerId, idempotencyKey]) ),
    // so it must not travel with the document.
    const res = await tx.document.updateMany({
      where: { id, ownerId: previousOwnerId, archivedAt: null },
      data: { ownerId: authd.user.id, idempotencyKey: null },
    });
    if (res.count === 0) return false;
    await tx.documentParticipant.upsert({
      where: { documentId_userId: { documentId: id, userId: previousOwnerId } },
      create: { documentId: id, userId: previousOwnerId, role: "REVIEWER" },
      update: { role: "REVIEWER" },
    });
    // Keep the claimer's own participant row (visibleToUser requires one — see
    // lib/documents.ts) but reset `required`: an owner can't review their own
    // doc, so a required row would deadlock the approval gate.
    await tx.documentParticipant.upsert({
      where: { documentId_userId: { documentId: id, userId: authd.user.id } },
      create: { documentId: id, userId: authd.user.id },
      update: { required: false },
    });
    // Dismiss any review the claimer left while still a REVIEWER — it must not
    // count toward the approval gate on their own plan (precedent: lib/sharing.ts removeParticipant).
    await tx.review.updateMany({ where: { documentId: id, reviewerId: authd.user.id }, data: { dismissed: true } });
    return true;
  });
  if (!claimed) return NextResponse.json({ error: "ownership changed, retry" }, { status: 409, headers: authd.headers });

  await notifyOwnershipClaimed(id, previousOwnerId, authd.user.id).catch(() => {});
  await recomputeStateAndDispatch(authd.user.id, id).catch(() => {});
  return NextResponse.json(
    { id, role: "OWNER", versionNumber: doc.currentVersion?.versionNumber ?? 0 },
    { headers: authd.headers },
  );
}
