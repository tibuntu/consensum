import { prisma } from "@/lib/db";

export async function notifyParticipants(documentId: string, actorId: string, type: string) {
  const participants = await prisma.documentParticipant.findMany({
    where: { documentId },
    select: { userId: true },
  });
  const ids = new Set<string>(participants.map((p) => p.userId));
  ids.delete(actorId);
  if (ids.size === 0) return;
  await prisma.notification.createMany({ data: [...ids].map((userId) => ({ userId, documentId, actorId, type })) });
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
