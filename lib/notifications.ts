import { prisma } from "@/lib/db";
import { enqueueEmailEvent } from "@/lib/email-digest";

const EMAILABLE = new Set(["comment", "review", "version"]);

export async function notifyParticipants(documentId: string, actorId: string, type: string) {
  const participants = await prisma.documentParticipant.findMany({
    where: { documentId },
    select: { userId: true, user: { select: { emailNotifications: true } } },
  });
  const recipients = participants.filter((p) => p.userId !== actorId);
  if (recipients.length === 0) return;

  // In-app notifications (unchanged behavior).
  await prisma.notification.createMany({
    data: recipients.map((p) => ({ userId: p.userId, documentId, actorId, type })),
  });

  // Email sink (best-effort, opted-in recipients only, emailable types only).
  if (EMAILABLE.has(type)) {
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
    const actorName = actor?.name ?? "Someone";
    for (const p of recipients) {
      if (p.user?.emailNotifications) {
        enqueueEmailEvent(p.userId, documentId, type as "comment" | "review" | "version", actorName);
      }
    }
  }
}

export async function listNotifications(userId: string) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: [{ read: "asc" }, { createdAt: "desc" }],
    take: 50,
    include: { document: { select: { title: true } } },
  });
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, read: false } });
}

export async function markRead(userId: string, id: string) {
  await prisma.notification.updateMany({ where: { id, userId }, data: { read: true } });
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
}
