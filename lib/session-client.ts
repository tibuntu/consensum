import type { DocEvent, ReviewSession } from "@/lib/events";

/** Pure reduction of a session event into the next session state, keyed by document. */
export function applySessionEvent(session: ReviewSession | null, event: DocEvent): ReviewSession | null {
  switch (event.type) {
    case "session.started":
    case "session.updated":
      return event.session;
    case "session.ended":
      return null;
    default:
      return session;
  }
}

export function isLeader(session: ReviewSession | null, userId: string): boolean {
  return session?.leaderId === userId;
}

export function isInSession(session: ReviewSession | null, userId: string): boolean {
  return !!session?.participants.some((p) => p.userId === userId);
}

export function canStart(session: ReviewSession | null): boolean {
  return session === null;
}
