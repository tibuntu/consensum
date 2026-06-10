import { describe, it, expect } from "vitest";
import { applySessionEvent, isLeader, isInSession, canStart } from "@/lib/session-client";
import type { ReviewSession } from "@/lib/events";

const session: ReviewSession = {
  sessionId: "s1", documentId: "d1", leaderId: "lead", leaderName: "Ada",
  participants: [
    { userId: "lead", name: "Ada", joinedAt: 1 },
    { userId: "u2", name: "Grace", joinedAt: 2 },
  ],
  startedAt: 1,
};

describe("applySessionEvent", () => {
  it("started and updated replace state with the snapshot", () => {
    expect(applySessionEvent(null, { type: "session.started", session })).toBe(session);
    expect(applySessionEvent(null, { type: "session.updated", session })).toBe(session);
  });
  it("ended clears state", () => {
    expect(applySessionEvent(session, { type: "session.ended" })).toBeNull();
  });
  it("ignores unrelated events", () => {
    expect(applySessionEvent(session, { type: "review.updated", state: "OPEN" })).toBe(session);
  });
});

describe("predicates", () => {
  it("isLeader", () => {
    expect(isLeader(session, "lead")).toBe(true);
    expect(isLeader(session, "u2")).toBe(false);
    expect(isLeader(null, "lead")).toBe(false);
  });
  it("isInSession", () => {
    expect(isInSession(session, "u2")).toBe(true);
    expect(isInSession(session, "stranger")).toBe(false);
    expect(isInSession(null, "u2")).toBe(false);
  });
  it("canStart only when no session", () => {
    expect(canStart(null)).toBe(true);
    expect(canStart(session)).toBe(false);
  });
});
