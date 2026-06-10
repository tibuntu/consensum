import type { PresenceEntry, ReviewSession } from "@/lib/events";

/** The session leader's vertical scroll fraction, but only for a non-leader participant
 *  of an active session whose leader is currently broadcasting a scroll. Else null. */
export function leaderScroll(
  roster: PresenceEntry[],
  session: ReviewSession | null,
  selfId: string,
): number | null {
  if (!session) return null;
  if (selfId === session.leaderId) return null;
  if (!session.participants.some((p) => p.userId === selfId)) return null;
  const leaderEntry = roster.find((e) => e.userId === session.leaderId);
  return leaderEntry?.scroll?.y ?? null;
}

/** Absolute window scrollTop that places `frac` of the doc-body box at the viewport top,
 *  given the box's current viewport-relative top and height. Inverse of the leader encode. */
export function scrollTargetTop(scrollY: number, rectTop: number, rectHeight: number, frac: number): number {
  return scrollY + rectTop + frac * rectHeight;
}
