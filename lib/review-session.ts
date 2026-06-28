import { publish, subscribeRemote, type ReviewSession, type SessionParticipant, type DocEvent } from "@/lib/events";
import { roster } from "@/lib/presence";

export type { ReviewSession, SessionParticipant };

type Registry = Map<string, ReviewSession>;

const globalForSession = globalThis as unknown as {
  reviewSessionRegistry?: Registry;
  reviewSessionSweep?: ReturnType<typeof setInterval>;
  reviewSessionSubscribed?: Set<string>;
};

const registry: Registry = globalForSession.reviewSessionRegistry ?? new Map();
if (process.env.NODE_ENV !== "production") globalForSession.reviewSessionRegistry = registry;

// Documents whose peer-replica session state we're already merging.
const subscribedDocs: Set<string> = globalForSession.reviewSessionSubscribed ?? new Set();
globalForSession.reviewSessionSubscribed = subscribedDocs;

// Merge a peer replica's session event into the local registry (no re-publish; on
// the single-instance backend this never fires). Combined with the cross-replica
// presence roster, every replica's evictStaleSessions sees the same membership, so
// leader-eviction and participant-pruning stay consistent across replicas.
function applyRemote(documentId: string, event: DocEvent): void {
  if (event.type === "session.started" || event.type === "session.updated") {
    registry.set(documentId, event.session);
  } else if (event.type === "session.ended") {
    registry.delete(documentId);
  }
}

function ensureSubscribed(documentId: string): void {
  if (subscribedDocs.has(documentId)) return;
  subscribedDocs.add(documentId);
  subscribeRemote(documentId, (event) => applyRemote(documentId, event));
}

/** Start a session led by `leader` (auto-joined). Returns null if one already exists. */
export function startSession(documentId: string, leader: { userId: string; name: string }): ReviewSession | null {
  ensureSubscribed(documentId);
  if (registry.has(documentId)) return null;
  const now = Date.now();
  const session: ReviewSession = {
    sessionId: crypto.randomUUID(),
    documentId,
    leaderId: leader.userId,
    leaderName: leader.name,
    participants: [{ userId: leader.userId, name: leader.name, joinedAt: now }],
    startedAt: now,
  };
  registry.set(documentId, session);
  publish(documentId, { type: "session.started", session });
  return session;
}

/** Add a participant to the active session (idempotent). Returns null if no session. */
export function joinSession(documentId: string, user: { userId: string; name: string }): ReviewSession | null {
  ensureSubscribed(documentId);
  const session = registry.get(documentId);
  if (!session) return null;
  if (session.participants.some((p) => p.userId === user.userId)) return session;
  session.participants.push({ userId: user.userId, name: user.name, joinedAt: Date.now() });
  publish(documentId, { type: "session.updated", session });
  return session;
}

/** Remove a non-leader participant; if the leader leaves, the session ends. No-op if absent. */
export function leaveSession(documentId: string, userId: string): void {
  const session = registry.get(documentId);
  if (!session) return;
  if (userId === session.leaderId) {
    endSession(documentId, userId);
    return;
  }
  const before = session.participants.length;
  session.participants = session.participants.filter((p) => p.userId !== userId);
  if (session.participants.length !== before) publish(documentId, { type: "session.updated", session });
}

/** End the session. Only the leader may end it. Ending an already-gone session is an
 *  idempotent success (handles the leader-drop-then-click race); a non-leader gets false. */
export function endSession(documentId: string, userId: string): boolean {
  const session = registry.get(documentId);
  if (!session) return true; // already ended (e.g. auto-ended by the sweep) — idempotent
  if (userId !== session.leaderId) return false;
  registry.delete(documentId);
  publish(documentId, { type: "session.ended" });
  return true;
}

/** Current session snapshot for a document, or null. */
export function getSession(documentId: string): ReviewSession | null {
  ensureSubscribed(documentId);
  return registry.get(documentId) ?? null;
}

/** End sessions whose leader left the presence roster; prune departed participants.
 *  Runs on every replica against the cross-replica roster, so all replicas agree;
 *  duplicate session.updated/ended across replicas are idempotent. */
export function evictStaleSessions(): void {
  const endedDocs: string[] = [];
  for (const [documentId, session] of registry) {
    const present = new Set(roster(documentId).map((e) => e.userId));
    if (!present.has(session.leaderId)) {
      endedDocs.push(documentId);
      continue;
    }
    const kept = session.participants.filter((p) => present.has(p.userId));
    if (kept.length !== session.participants.length) {
      session.participants = kept;
      publish(documentId, { type: "session.updated", session });
    }
  }
  for (const documentId of endedDocs) {
    registry.delete(documentId);
    publish(documentId, { type: "session.ended" });
  }
}

// One process-wide sweep, guarded so dev hot-reload doesn't spawn duplicates.
if (!globalForSession.reviewSessionSweep) {
  const sweepMs = Number(process.env.SESSION_SWEEP_MS ?? 10_000);
  const timer = setInterval(evictStaleSessions, sweepMs);
  timer.unref?.();
  globalForSession.reviewSessionSweep = timer;
}
