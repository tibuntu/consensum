import { describe, it, expect, vi, afterEach } from "vitest";
import { subscribe, type DocEvent } from "@/lib/events";
import {
  startSession, joinSession, leaveSession, endSession, getSession, evictStaleSessions,
} from "@/lib/review-session";
import * as presence from "@/lib/presence";

function capture(docId: string): { events: DocEvent[]; stop: () => void } {
  const events: DocEvent[] = [];
  const stop = subscribe(docId, (e) => events.push(e));
  return { events, stop };
}
const leader = { userId: "lead", name: "Ada" };

afterEach(() => vi.restoreAllMocks());

describe("review-session registry", () => {
  it("startSession creates a session with the leader joined and emits session.started", () => {
    const { events, stop } = capture("s-doc-1");
    const s = startSession("s-doc-1", leader);
    expect(s).not.toBeNull();
    expect(s!.leaderId).toBe("lead");
    expect(s!.participants.map((p) => p.userId)).toEqual(["lead"]);
    expect(events).toContainEqual(expect.objectContaining({ type: "session.started" }));
    stop();
    endSession("s-doc-1", "lead");
  });

  it("rejects a second concurrent session for the same document", () => {
    startSession("s-doc-2", leader);
    const { events, stop } = capture("s-doc-2");
    const second = startSession("s-doc-2", { userId: "other", name: "Bo" });
    expect(second).toBeNull();
    expect(events).toHaveLength(0);
    stop();
    endSession("s-doc-2", "lead");
  });

  it("joinSession appends a participant and emits session.updated; repeat join is a no-op", () => {
    startSession("s-doc-3", leader);
    const { events, stop } = capture("s-doc-3");
    joinSession("s-doc-3", { userId: "u2", name: "Grace" });
    expect(getSession("s-doc-3")!.participants.map((p) => p.userId)).toEqual(["lead", "u2"]);
    joinSession("s-doc-3", { userId: "u2", name: "Grace" }); // idempotent
    expect(getSession("s-doc-3")!.participants.filter((p) => p.userId === "u2")).toHaveLength(1);
    expect(events.filter((e) => e.type === "session.updated")).toHaveLength(1);
    stop();
    endSession("s-doc-3", "lead");
  });

  it("non-leader leaveSession removes them; leader leaveSession ends the session", () => {
    startSession("s-doc-4", leader);
    joinSession("s-doc-4", { userId: "u2", name: "Grace" });
    leaveSession("s-doc-4", "u2");
    expect(getSession("s-doc-4")!.participants.map((p) => p.userId)).toEqual(["lead"]);
    leaveSession("s-doc-4", "lead");
    expect(getSession("s-doc-4")).toBeNull();
  });

  it("endSession is leader-only", () => {
    startSession("s-doc-5", leader);
    const { events, stop } = capture("s-doc-5");
    expect(endSession("s-doc-5", "u2")).toBe(false);
    expect(events).toHaveLength(0);
    expect(endSession("s-doc-5", "lead")).toBe(true);
    expect(events).toContainEqual({ type: "session.ended" });
    expect(getSession("s-doc-5")).toBeNull();
    stop();
  });

  it("ending an already-gone session is an idempotent no-op success", () => {
    const { events, stop } = capture("s-doc-5b");
    expect(endSession("s-doc-5b", "anyone")).toBe(true); // no session exists
    expect(events).toHaveLength(0); // nothing re-published
    stop();
  });

  it("evictStaleSessions ends sessions whose leader left the roster", () => {
    startSession("s-doc-6", leader);
    vi.spyOn(presence, "roster").mockReturnValue([]); // nobody present
    evictStaleSessions();
    expect(getSession("s-doc-6")).toBeNull();
  });

  it("evictStaleSessions prunes participants who left the roster", () => {
    startSession("s-doc-7", leader);
    joinSession("s-doc-7", { userId: "u2", name: "Grace" });
    vi.spyOn(presence, "roster").mockReturnValue([
      { userId: "lead", name: "Ada", lastSeen: Date.now() },
    ]); // leader present, u2 gone
    const { events, stop } = capture("s-doc-7");
    evictStaleSessions();
    expect(getSession("s-doc-7")!.participants.map((p) => p.userId)).toEqual(["lead"]);
    expect(events.filter((e) => e.type === "session.updated")).toHaveLength(1);
    stop();
    endSession("s-doc-7", "lead");
  });
});
