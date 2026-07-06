import { describe, it, expect } from "vitest";
// The hook's verdict logic, extracted to a side-effect-free module so it can be
// exercised without the blocking I/O loop.
import { decide, fingerprint, buildDigest, titleFromMarkdown, idempotencyKeyFor, allowPayload, denyPayload } from "../../dist/claude/hooks/consensum-hook-core.mjs";

const approved = { decision: "approved", approvals: 1, reviews: [], threads: [] };
const changes = (over: Record<string, unknown> = {}) => ({
  decision: "changes_requested",
  approvals: 0,
  requiredApprovals: 1,
  reviews: [{ reviewer: "R", verdict: "REQUEST_CHANGES", dismissed: false }],
  threads: [{ id: "t1", threadStatus: "OPEN", severity: "BLOCKER", quote: "rollback undefined", mustResolve: true, comments: [{ body: "define rollback" }] }],
  rollup: { blocking: 1, unresolved: 1, mustResolve: 1 },
  ...over,
});

describe("hook decide() — never proceed while blocked", () => {
  it("allows only on approved", () => {
    expect(decide(approved, undefined).action).toBe("allow");
  });

  it("never allows while changes_requested: denies new feedback once, then waits on the same feedback (anti-storm)", () => {
    const fb = changes();
    const first = decide(fb, undefined);
    expect(first.action).toBe("deny"); // new reviewer activity -> relay
    const second = decide(fb, first.fingerprint); // our revision relayed; same verdict -> do NOT re-fire
    expect(second.action).toBe("wait");
    // Crucially, an active changes_requested can never resolve to "allow".
    expect(decide(fb, undefined).action).not.toBe("allow");
    expect(decide(fb, "stale-other").action).not.toBe("allow");
  });

  it("keeps long-polling while pending", () => {
    expect(decide({ decision: "pending", reviews: [], threads: [] }, undefined).action).toBe("pending");
  });
});

describe("hook fingerprint() — stable across our own revision, changes on re-review (anti-storm)", () => {
  it("is identical for identical reviewer activity", () => {
    expect(fingerprint(changes())).toBe(fingerprint(changes()));
  });

  it("changes when a new comment lands (a real re-review)", () => {
    const a = changes();
    const b = changes({
      threads: [{ id: "t1", threadStatus: "OPEN", severity: "BLOCKER", quote: "rollback undefined", mustResolve: true, comments: [{ body: "define rollback" }, { body: "still not addressed" }] }],
    });
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });
});

describe("hook buildDigest()", () => {
  it("surfaces the must-resolve blocker count and marks the blocker", () => {
    const d = buildDigest(changes(), "http://x/documents/1");
    expect(d).toContain("must-resolve blockers: 1");
    expect(d).toContain("(MUST RESOLVE)");
    expect(d).toContain("rollback undefined");
  });
});

describe("titleFromMarkdown", () => {
  it("uses the first heading, else 'Plan'", () => {
    expect(titleFromMarkdown("# Deploy Plan\n\nbody")).toBe("Deploy Plan");
    expect(titleFromMarkdown("no heading here")).toBe("Plan");
  });
});

describe("idempotencyKeyFor — Idempotency-Key must be a Latin-1-safe header value", () => {
  const sessionId = "0b8e2c1a-1234-4abc-9def-0123456789ab";

  it("is ByteString-safe for titles with em dashes and arrows", () => {
    const key = idempotencyKeyFor(sessionId, "# BIGBOB-2574 — Enable Grafana Log Patterns → prod\n\nbody");
    for (let i = 0; i < key.length; i++) {
      expect(key.charCodeAt(i)).toBeLessThanOrEqual(255);
    }
  });

  it("is stable for identical input (the idempotency contract)", () => {
    const md = "# Rollout — Phase 2\n\nbody";
    expect(idempotencyKeyFor(sessionId, md)).toBe(idempotencyKeyFor(sessionId, md));
  });

  it("is scoped per session", () => {
    const md = "# Same Plan\n\nbody";
    expect(idempotencyKeyFor("session-a", md)).not.toBe(idempotencyKeyFor("session-b", md));
  });

  it("bounds the encoded title so the header stays small", () => {
    const key = idempotencyKeyFor(sessionId, `# ${"🚀".repeat(1000)}\n\nbody`);
    expect(key.length).toBeLessThanOrEqual(sessionId.length + 1 + 512);
  });

  it("falls back to the default title for heading-less markdown", () => {
    expect(idempotencyKeyFor(sessionId, "no heading here")).toBe(`${sessionId}:Plan`);
  });
});

describe("PermissionRequest payload shapes (handshake guard)", () => {
  it("allowPayload is the exact allow handshake", () => {
    expect(allowPayload()).toEqual({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
  });
  it("denyPayload carries the message on a deny handshake", () => {
    expect(denyPayload("revise this")).toEqual({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "revise this" } } });
  });
});

describe("buildDigest emits the full comment thread", () => {
  it("includes every comment, not just the last", () => {
    const fb = {
      decision: "changes_requested", approvals: 0, requiredApprovals: 1, reviews: [],
      rollup: { blocking: 1, unresolved: 1, mustResolve: 1 },
      threads: [{ id: "t", threadStatus: "OPEN", severity: "BLOCKER", quote: "x", mustResolve: true, comments: [{ body: "first point" }, { body: "second point" }] }],
    };
    const d = buildDigest(fb, "http://x/1");
    expect(d).toContain("first point");
    expect(d).toContain("second point");
  });
});
