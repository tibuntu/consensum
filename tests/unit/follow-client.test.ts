import { describe, it, expect } from "vitest";
import { leaderScroll, scrollTargetTop } from "@/lib/follow-client";
import type { PresenceEntry, ReviewSession } from "@/lib/events";

function session(leaderId: string, participantIds: string[]): ReviewSession {
  return {
    sessionId: "s1",
    documentId: "d1",
    leaderId,
    leaderName: "Ada",
    participants: participantIds.map((userId) => ({ userId, name: userId, joinedAt: 0 })),
    startedAt: 0,
  };
}
function entry(userId: string, scroll?: { y: number }): PresenceEntry {
  return { userId, name: userId, lastSeen: 0, ...(scroll ? { scroll } : {}) };
}

describe("leaderScroll", () => {
  const roster = [entry("leader", { y: 0.6 }), entry("follower")];

  it("returns the leader's scroll for a non-leader participant", () => {
    expect(leaderScroll(roster, session("leader", ["leader", "follower"]), "follower")).toBe(0.6);
  });
  it("returns null for the leader themselves", () => {
    expect(leaderScroll(roster, session("leader", ["leader", "follower"]), "leader")).toBeNull();
  });
  it("returns null for a non-participant", () => {
    expect(leaderScroll(roster, session("leader", ["leader"]), "outsider")).toBeNull();
  });
  it("returns null when there is no session", () => {
    expect(leaderScroll(roster, null, "follower")).toBeNull();
  });
  it("returns null when the leader has no scroll yet", () => {
    expect(leaderScroll([entry("leader"), entry("follower")], session("leader", ["leader", "follower"]), "follower")).toBeNull();
  });
});

describe("scrollTargetTop", () => {
  it("decodes the fraction into an absolute scrollTop", () => {
    expect(scrollTargetTop(100, -50, 2000, 0.5)).toBe(100 + -50 + 1000);
  });
});
