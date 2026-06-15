#!/usr/bin/env node
// Consensum auto-proceed hook for Claude Code's `ExitPlanMode` tool.
//
// Registered as a `PermissionRequest` hook (see .claude/settings.json). When the
// agent finishes planning and calls ExitPlanMode, this script BLOCKS inside that
// tool call: it pushes the plan to Consensum, waits for the team's verdict, then
//   - APPROVED          -> returns `allow`  (Claude exits plan mode and implements)
//   - CHANGES_REQUESTED -> returns `deny` + a feedback digest (Claude revises and
//                          re-presents the plan, which re-fires this hook -> the loop)
//
// It NEVER blocks a developer who hasn't configured Consensum: with no token it
// returns `allow` immediately. State is scoped per Claude Code `session_id`, so a
// fresh session creates a new plan while a re-fired ExitPlanMode in the same
// session PATCHes a new version of the same plan.
//
// Verified against the format plannotator (plannotator.ai) uses for ExitPlanMode.
// If a future Claude Code version changes the handshake, `allowDecision` /
// `denyDecision` below are the only things to adjust.

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.CONSENSUM_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const TOKEN = process.env.CONSENSUM_API_TOKEN || "";
const WAIT_MS = 30000; // per long-poll request
const STALE_POLL_MS = 8000; // backoff while waiting for a re-review of our revision
const MAX_MS = Number(process.env.CONSENSUM_LOOP_MAX_MS) || 4 * 24 * 60 * 60 * 1000; // safety deadline

// ---- hook I/O ----------------------------------------------------------------

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}
const allowDecision = () => emit({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
const denyDecision = (message) => emit({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message } } });

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

// ---- per-project, per-session state -----------------------------------------

function stateFile(cwd) {
  return join(cwd || process.cwd(), ".consensum", "loop-state.json");
}
function loadState(cwd) {
  try {
    return JSON.parse(readFileSync(stateFile(cwd), "utf8"));
  } catch {
    return {};
  }
}
function saveState(cwd, all) {
  const dir = join(cwd || process.cwd(), ".consensum");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(stateFile(cwd), JSON.stringify(all, null, 2));
}

// ---- Consensum machine API ---------------------------------------------------

const authHeaders = { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: authHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

function titleFromMarkdown(md) {
  const m = (md || "").match(/^\s*#\s+(.+?)\s*$/m);
  return (m && m[1].trim()) || "Plan";
}

// A digest of reviewer activity (NOT the version), so PATCHing a revision alone
// does not look like new feedback — only an actual re-review does.
function fingerprint(fb) {
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

const SEV_RANK = { BLOCKER: 0, MAJOR: 1, MINOR: 2, NIT: 3 };
function buildDigest(fb, reviewUrl) {
  const lines = [
    `The team reviewed your plan and requested changes (approvals ${fb.approvals}/${fb.requiredApprovals}).`,
    `Blocking: ${fb.rollup?.blocking ?? 0}, unresolved: ${fb.rollup?.unresolved ?? 0}.`,
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
    const cs = t.comments || [];
    const last = cs.length ? cs[cs.length - 1].body : "(no comment)";
    lines.push(`- ${sev}On "${t.quote ?? "(unanchored)"}": ${last}`);
  }
  lines.push("", `Full review: ${reviewUrl}`, "Revise the plan to address every point (blockers first), then present the updated plan.");
  return lines.join("\n");
}

// ---- main --------------------------------------------------------------------

async function main() {
  const input = readStdin();
  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id || "default";
  const plan = input.tool_input?.plan;

  if (!plan) allowDecision(); // nothing to review
  if (!TOKEN) {
    process.stderr.write("[consensum] CONSENSUM_API_TOKEN not set — skipping review, proceeding.\n");
    allowDecision();
  }

  const all = loadState(cwd);
  let entry = all[sessionId];

  // 1) Push a fresh plan, or PATCH a revision of the same session's plan.
  let reviewUrl;
  if (entry?.planId) {
    const patch = await api("PATCH", `/api/plans/${entry.planId}`, { markdown: plan, baseVersionNumber: entry.baseVersionNumber });
    if (patch.status === 409) {
      // Stale base version — re-sync to the server's current version and retry once.
      const snap = await api("GET", `/api/plans/${entry.planId}/feedback`);
      const current = snap.json?.currentVersion;
      if (typeof current === "number") {
        const retry = await api("PATCH", `/api/plans/${entry.planId}`, { markdown: plan, baseVersionNumber: current });
        if (!retry.json?.unchanged && retry.json?.version?.versionNumber) entry.baseVersionNumber = retry.json.version.versionNumber;
        else entry.baseVersionNumber = current;
      }
    } else if (patch.status === 404) {
      entry = undefined; // plan vanished (deleted / not owned) — fall through to a fresh push
    } else if (patch.json?.version?.versionNumber) {
      entry.baseVersionNumber = patch.json.version.versionNumber;
    }
    if (entry) reviewUrl = `${BASE}/app/documents/${entry.planId}`;
  }

  if (!entry?.planId) {
    const created = await api("POST", "/api/plans", { title: titleFromMarkdown(plan), markdown: plan });
    if (created.status >= 400 || !created.json?.id) {
      process.stderr.write(`[consensum] push failed (HTTP ${created.status}) — proceeding without review.\n`);
      allowDecision();
    }
    entry = { planId: created.json.id, baseVersionNumber: 1, lastFingerprint: undefined };
    reviewUrl = created.json.reviewUrl || `${BASE}/app/documents/${entry.planId}`;
    process.stderr.write(`[consensum] Plan posted for review: ${reviewUrl}\n`);
  }
  all[sessionId] = entry;
  saveState(cwd, all);

  // 2) Block until the team renders a verdict on THIS revision.
  const deadline = Date.now() + MAX_MS;
  while (Date.now() < deadline) {
    let fb;
    // While pending, long-poll (blocks server-side). While non-pending-but-stale
    // (a revision we already relayed, awaiting re-review), the wait endpoint
    // returns instantly, so back off with a fixed sleep before re-reading.
    const pendingProbe = await api("GET", `/api/plans/${entry.planId}/feedback`);
    if (pendingProbe.status === 404) allowDecision(); // plan gone — don't trap the agent
    if (pendingProbe.json?.decision === "pending") {
      const waited = await api("GET", `/api/plans/${entry.planId}/feedback/wait?timeoutMs=${WAIT_MS}`);
      fb = waited.json || pendingProbe.json;
    } else {
      fb = pendingProbe.json;
    }

    if (fb?.decision === "approved") {
      delete all[sessionId];
      saveState(cwd, all);
      allowDecision();
    }

    if (fb?.decision === "changes_requested") {
      const fp = fingerprint(fb);
      if (fp !== entry.lastFingerprint) {
        // New reviewer activity on the current version — relay it and let the agent revise.
        entry.lastFingerprint = fp;
        all[sessionId] = entry;
        saveState(cwd, all);
        denyDecision(buildDigest(fb, reviewUrl));
      }
      // Stale: same verdict we already relayed; reviewer hasn't re-reviewed our
      // revision yet. Wait quietly.
      await new Promise((r) => setTimeout(r, STALE_POLL_MS));
      continue;
    }
    // pending and timed out: loop re-arms the long-poll.
  }

  denyDecision(`Plan still pending team review after the configured wait window. Re-enter plan mode and present it again when you're ready to retry. Review: ${reviewUrl}`);
}

main().catch((err) => {
  // On any unexpected failure, fail OPEN so the agent is never trapped.
  process.stderr.write(`[consensum] hook error: ${err?.stack || err}\n`);
  allowDecision();
});
