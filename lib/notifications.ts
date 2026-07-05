import { prisma } from "@/lib/db";
import { enqueueEmailEvent } from "@/lib/email-digest";
import { publish, type ClientNotification } from "@/lib/events";
import { parsePrefs, isEnabled } from "@/lib/notification-prefs";
import type { NotificationType } from "@/lib/enums";

const EMAILABLE = new Set(["comment", "review", "version", "review_requested"]);

export async function notifyParticipants(documentId: string, actorId: string, type: string) {
  const participants = await prisma.documentParticipant.findMany({
    where: { documentId },
    select: { userId: true, user: { select: { notificationPrefs: true } } },
  });
  const recipients = participants.filter((p) => p.userId !== actorId);
  if (recipients.length === 0) return;

  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { title: true } });
  const documentTitle = doc?.title ?? "";
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true, email: true } });
  const actorName = actor?.name?.trim() || actor?.email || "Someone";

  const nt = type as NotificationType;

  for (const p of recipients) {
    const prefs = parsePrefs(p.user?.notificationPrefs);

    // In-app: create + publish only if enabled for this type.
    if (isEnabled(prefs, nt, "inApp")) {
      const row = await prisma.notification.create({
        data: { userId: p.userId, documentId, actorId, type },
      });
      const payload: ClientNotification = {
        id: row.id,
        type: row.type,
        documentId,
        documentTitle,
        actorId: row.actorId,
        actorName,
        read: row.read,
        createdAt: row.createdAt.toISOString(),
      };
      publish(`user-${p.userId}`, { type: "notification.created", notification: payload });
    }

    // Email: only emailable types, and only if enabled for this recipient.
    if (EMAILABLE.has(type) && isEnabled(prefs, nt, "email")) {
      enqueueEmailEvent(p.userId, documentId, type as "comment" | "review" | "version", actorName);
    }
  }
}

/** Notify a single newly-added participant that a document was shared with them.
 *  In-app + desktop only (never emailed); respects the recipient's inApp pref. */
export async function notifyShared(documentId: string, recipientId: string, actorId: string) {
  const [doc, actor, recipient] = await Promise.all([
    prisma.document.findUnique({ where: { id: documentId }, select: { title: true } }),
    prisma.user.findUnique({ where: { id: actorId }, select: { name: true, email: true } }),
    prisma.user.findUnique({ where: { id: recipientId }, select: { notificationPrefs: true } }),
  ]);
  const prefs = parsePrefs(recipient?.notificationPrefs);
  if (!isEnabled(prefs, "shared" as NotificationType, "inApp")) return;

  const actorName = actor?.name?.trim() || actor?.email || "Someone";
  const row = await prisma.notification.create({
    data: { userId: recipientId, documentId, actorId, type: "shared" },
  });
  const payload: ClientNotification = {
    id: row.id,
    type: row.type,
    documentId,
    documentTitle: doc?.title ?? "",
    actorId: row.actorId,
    actorName,
    read: row.read,
    createdAt: row.createdAt.toISOString(),
  };
  publish(`user-${recipientId}`, { type: "notification.created", notification: payload });
}

/** Notify a single participant they've been made a required reviewer. In-app +
 *  desktop + email (respects the recipient's prefs). Fired on a false→true
 *  required transition, and in place of `shared` when a new participant is
 *  created already-required. */
export async function notifyReviewRequested(documentId: string, recipientId: string, actorId: string) {
  const [doc, actor, recipient] = await Promise.all([
    prisma.document.findUnique({ where: { id: documentId }, select: { title: true } }),
    prisma.user.findUnique({ where: { id: actorId }, select: { name: true, email: true } }),
    prisma.user.findUnique({ where: { id: recipientId }, select: { notificationPrefs: true } }),
  ]);
  const prefs = parsePrefs(recipient?.notificationPrefs);
  const actorName = actor?.name?.trim() || actor?.email || "Someone";

  if (isEnabled(prefs, "review_requested" as NotificationType, "inApp")) {
    const row = await prisma.notification.create({
      data: { userId: recipientId, documentId, actorId, type: "review_requested" },
    });
    const payload: ClientNotification = {
      id: row.id,
      type: row.type,
      documentId,
      documentTitle: doc?.title ?? "",
      actorId: row.actorId,
      actorName,
      read: row.read,
      createdAt: row.createdAt.toISOString(),
    };
    publish(`user-${recipientId}`, { type: "notification.created", notification: payload });
  }

  if (isEnabled(prefs, "review_requested" as NotificationType, "email")) {
    enqueueEmailEvent(recipientId, documentId, "review_requested" as "comment" | "review" | "version", actorName);
  }
}

export async function listNotifications(userId: string) {
  const rows = await prisma.notification.findMany({
    where: { userId },
    orderBy: [{ read: "asc" }, { createdAt: "desc" }],
    take: 50,
    include: { document: { select: { title: true } } },
  });
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } })
    : [];
  const nameById = new Map(actors.map((a) => [a.id, a.name?.trim() || a.email || "Someone"] as const));
  // Match notifyParticipants: a known but since-deleted actor falls back to
  // "Someone" (not the generic label), so live and reloaded inbox labels agree.
  return rows.map((r) => ({ ...r, actorName: r.actorId ? nameById.get(r.actorId) ?? "Someone" : null }));
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, read: false } });
}

export async function markRead(userId: string, id: string) {
  await prisma.notification.updateMany({ where: { id, userId }, data: { read: true } });
  publish(`user-${userId}`, { type: "notification.read", id });
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
  publish(`user-${userId}`, { type: "notification.read.all" });
}
