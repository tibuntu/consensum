"use client";
import { Button } from "@/components/ui/Button";
import type { ReviewSession } from "@/lib/events";
import { isLeader, isInSession, canStart } from "@/lib/session-client";
import type { SessionAction } from "@/lib/enums";

export default function SessionBanner({
  session,
  currentUserId,
  onAction,
  pending,
}: {
  session: ReviewSession | null;
  currentUserId: string;
  onAction: (action: SessionAction) => void;
  pending: boolean;
}) {
  if (canStart(session)) {
    return (
      <Button
        variant="secondary"
        size="sm"
        data-testid="start-session"
        disabled={pending}
        onClick={() => onAction("start")}
      >
        Start session
      </Button>
    );
  }

  const s = session!;
  const leader = isLeader(s, currentUserId);
  const joined = isInSession(s, currentUserId);
  const count = s.participants.length;

  return (
    <div
      data-testid="session-banner"
      className="flex items-center gap-2 rounded-[var(--radius-app)] border border-border bg-surface px-3 py-1 text-sm"
    >
      {leader ? (
        <span>
          You&apos;re leading · <span data-testid="session-participant-count">{count}</span> participant
          {count === 1 ? "" : "s"}
        </span>
      ) : (
        <span>
          <span data-testid="session-leader-name">{s.leaderName}</span> is leading a review session ·{" "}
          <span data-testid="session-participant-count">{count}</span> in session
        </span>
      )}
      {leader ? (
        <Button variant="danger" size="sm" data-testid="end-session" disabled={pending} onClick={() => onAction("end")}>
          End session
        </Button>
      ) : joined ? (
        <Button variant="secondary" size="sm" data-testid="leave-session" disabled={pending} onClick={() => onAction("leave")}>
          Leave
        </Button>
      ) : (
        <Button variant="secondary" size="sm" data-testid="join-session" disabled={pending} onClick={() => onAction("join")}>
          Join
        </Button>
      )}
    </div>
  );
}
