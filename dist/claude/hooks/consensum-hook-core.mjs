// Pure, side-effect-free helpers for the Consensum ExitPlanMode hook
// (consensum-exit-plan.mjs), which runs on two events: the PermissionRequest
// gate and the PostToolUse backstop. Extracted so the verdict logic,
// fingerprint, digest, and payload shapes can be unit-tested without running
// the hook's I/O or blocking loop.

import { createHash } from "node:crypto";

export function titleFromMarkdown(md) {
  const m = (md || "").match(/^\s*#\s+(.+?)\s*$/m);
  return (m && m[1].trim()) || "Plan";
}

// HTTP header values must be ByteStrings (Latin-1) — fetch() throws on any
// char > U+00FF, so a plan title with an em dash would fail the create closed.
// Percent-encode the title portion (pure ASCII) and bound its length: a
// MAX_PLAN_TITLE_CHARS title of astral-plane characters would otherwise encode
// to ~12 KB, near Node's 16 KB header-block limit. The server treats the key
// as opaque, so encoding/truncation only needs to be deterministic.
export function idempotencyKeyFor(sessionId, markdown) {
  return `${sessionId}:${encodeURIComponent(titleFromMarkdown(markdown)).slice(0, 512)}`;
}

// The exact PermissionRequest `hookSpecificOutput` shapes Claude Code expects.
// Centralized here so a regression test pins the handshake contract;
// the hook emits these verbatim.
export function allowPayload() {
  return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } };
}
export function denyPayload(message) {
  return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message } } };
}

// PostToolUse's block handshake is a TOP-LEVEL decision, not hookSpecificOutput.
// The reason is fed back to Claude after the tool already ran.
export function postBlockPayload(reason) {
  return { decision: "block", reason };
}

export function planHash(markdown) {
  return createHash("sha256").update(markdown || "", "utf8").digest("hex");
}

// True iff this exact plan content was already approved for this session —
// the handshake that lets the PostToolUse backstop pass without re-reviewing
// what the PermissionRequest gate just approved. Hashing the FINAL tool_input
// means a plan rewritten by another hook (updatedInput) will not match and
// correctly goes through review.
export function approvedMatch(entry, markdown) {
  return !!entry?.approvedHash && entry.approvedHash === planHash(markdown);
}

// Drop state entries not touched within maxAgeMs. Approval records are kept
// (instead of the old delete-on-approve) so the backstop can recognize them;
// this prune is what stops the state file from growing forever. Entries
// without updatedAt (written by older hook versions) are kept — they get
// stamped on their next write.
export function pruneState(all, nowMs, maxAgeMs = 14 * 24 * 60 * 60 * 1000) {
  const kept = {};
  for (const [sessionId, entry] of Object.entries(all || {})) {
    const touched = entry?.updatedAt ? Date.parse(entry.updatedAt) : NaN;
    if (Number.isNaN(touched) || nowMs - touched <= maxAgeMs) kept[sessionId] = entry;
  }
  return kept;
}

// A digest of reviewer ACTIVITY (not the plan version), so PATCHing a revision
// alone does not look like new feedback — only an actual re-review does. This is
// what prevents a re-revision storm on the hook path.
export function fingerprint(fb) {
  const reviews = (fb.reviews || [])
    .map((r) => `${r.reviewer}|${r.verdict}|${r.dismissed}`)
    .sort()
    .join(";");
  const threads = (fb.threads || [])
    .map((t) => {
      const cs = t.comments || [];
      const last = cs.length ? cs[cs.length - 1].body : "";
      return `${t.id}|${t.threadStatus}|${cs.length}|${last}`;
    })
    .sort()
    .join(";");
  return `a=${fb.approvals};r=[${reviews}];t=[${threads}]`;
}

export const SEV_RANK = { BLOCKER: 0, MAJOR: 1, MINOR: 2, NIT: 3 };

export function buildDigest(fb, reviewUrl) {
  const lines = [
    `The team reviewed your plan and requested changes (approvals ${fb.approvals}/${fb.requiredApprovals}).`,
    `Blocking: ${fb.rollup?.blocking ?? 0}, unresolved: ${fb.rollup?.unresolved ?? 0}, must-resolve blockers: ${fb.rollup?.mustResolve ?? 0}.`,
    "",
  ];
  const threads = [...(fb.threads || [])].sort((a, b) => {
    const ra = SEV_RANK[a.severity] ?? (a.threadStatus === "OPEN" ? 4 : 5);
    const rb = SEV_RANK[b.severity] ?? (b.threadStatus === "OPEN" ? 4 : 5);
    return ra - rb;
  });
  if (threads.length === 0) lines.push("_No inline comments — see the review for verdict rationale._");
  for (const t of threads) {
    const sev = t.severity ? `[${t.severity}] ` : "";
    const mustFix = t.mustResolve ? " (MUST RESOLVE)" : "";
    const cs = t.comments || [];
    lines.push(`- ${sev}On "${t.quote ?? "(unanchored)"}"${mustFix}:`);
    // Emit the FULL discussion, not just the last comment — an agent that
    // sees only the latest reply can miss earlier, still-unaddressed points.
    if (cs.length === 0) lines.push("    (no comment)");
    for (const c of cs) lines.push(`    • ${c.body}`);
  }
  lines.push("", `Full review: ${reviewUrl}`, "Revise the plan to address every point (blockers first), then present the updated plan.");
  return lines.join("\n");
}

// Verdict logic for a feedback snapshot, given the fingerprint of the reviewer
// activity we last relayed. Pure — the hook performs the I/O around it.
//   approved          -> allow (Claude exits plan mode and implements)
//   changes_requested -> deny (new activity) | wait (stale: our revision not yet re-reviewed)
//   pending           -> keep long-polling
export function decide(fb, lastFingerprint) {
  const decision = fb?.decision;
  if (decision === "approved") return { action: "allow" };
  if (decision === "changes_requested") {
    const fp = fingerprint(fb);
    return fp !== lastFingerprint ? { action: "deny", fingerprint: fp } : { action: "wait", fingerprint: fp };
  }
  return { action: "pending" };
}
