#!/usr/bin/env node
// Consensum auto-proceed hook for Claude Code's `ExitPlanMode` tool.
//
// Registered on TWO events (see .claude/settings.json), both handled by this
// script, branched on the `hook_event_name` field of the stdin payload:
//
//   PermissionRequest (the gate) — when the agent calls ExitPlanMode, this
//   script BLOCKS inside that tool call: it pushes the plan to Consensum,
//   waits for the team's verdict, then
//     - APPROVED          -> returns `allow` (Claude exits plan mode and implements)
//     - CHANGES_REQUESTED -> returns `deny` + a feedback digest (Claude revises and
//                            re-presents the plan, which re-fires this hook -> the loop)
//
//   PostToolUse (the backstop) — Claude Code runs all matching PermissionRequest
//   hooks in parallel and the merge rule for conflicting decisions is
//   undocumented, so another hook's instant `allow` (e.g. plannotator's
//   "approve and continue" auto-mode) can win the race over our still-polling
//   gate and start implementation with zero review. This event fires after
//   plan mode actually exits, regardless of which hook allowed it. If the gate
//   already approved this exact plan content (sha256 handshake via
//   .consensum/loop-state.json), it passes silently; otherwise it runs the
//   same push-and-wait gate and emits `{"decision":"block"}` so Claude revises
//   instead of implementing.
//
// FAIL-CLOSED: if the hook is installed but cannot complete a review — no token,
// push failure, plan vanished, or an unexpected error — it refuses (deny/block)
// with a clear, in-band message rather than silently proceeding with an
// un-reviewed plan. To deliberately bypass review (e.g. Consensum not used on
// this project), set CONSENSUM_SKIP=1 (or remove the hook). State is scoped per
// Claude Code `session_id`, so a fresh session creates a new plan while a
// re-fired ExitPlanMode in the same session PATCHes a new version of the same
// plan. On approval the state entry records the approved content's hash (the
// gate<->backstop handshake); presenting different content afterwards starts a
// fresh review cycle. State writes are atomic (tmp+rename) and re-read before
// writing, so a concurrently running sibling hook process can't tear the file.
//
// Verified against the format plannotator (plannotator.ai) uses for ExitPlanMode.
// If a future Claude Code version changes the handshake, `allowPayload` /
// `denyPayload` / `postBlockPayload` in consensum-hook-core.mjs are the only
// things to adjust.

import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  idempotencyKeyFor,
  titleFromMarkdown,
  buildDigest,
  decide,
  allowPayload,
  denyPayload,
  postBlockPayload,
  planHash,
  approvedMatch,
  pruneState,
} from "./consensum-hook-core.mjs";

const BASE = (process.env.CONSENSUM_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const TOKEN = process.env.CONSENSUM_API_TOKEN || "";
const SKIP = process.env.CONSENSUM_SKIP === "1" || process.env.CONSENSUM_DISABLED === "1";
const WAIT_MS = 30000; // per long-poll request
const STALE_POLL_MS = 8000; // backoff while waiting for a re-review of our revision
const MAX_MS = Number(process.env.CONSENSUM_LOOP_MAX_MS) || 4 * 24 * 60 * 60 * 1000; // safety deadline

// ---- hook I/O ----------------------------------------------------------------

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}
const allowDecision = () => emit(allowPayload());
const denyDecision = (message) => emit(denyPayload(message));
// PostToolUse pass: exit 0 with no output is the documented no-op.
const passDecision = () => process.exit(0);
// A PostToolUse block cannot force Claude back into plan mode, so the reason
// itself must carry the do-not-implement instruction.
const blockDecision = (message) =>
  emit(postBlockPayload(`Do NOT implement this plan — it has not passed Consensum review. ${message}`));

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
// Re-read before mutating (tolerates a concurrently running sibling hook,
// last-writer-wins), prune stale sessions, and write atomically so a killed
// process can't leave torn JSON behind.
function updateState(cwd, mutate) {
  const all = loadState(cwd);
  mutate(all);
  const pruned = pruneState(all, Date.now());
  const file = stateFile(cwd);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(pruned, null, 2));
  renameSync(`${file}.tmp`, file);
}

// ---- Consensum machine API ---------------------------------------------------

const authHeaders = { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

async function api(method, path, body, extraHeaders) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...authHeaders, ...(extraHeaders || {}) },
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

// ---- the push-and-wait gate (shared by both events) ---------------------------

async function runGate({ cwd, sessionId, plan, entry, proceed, refuse }) {
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
        if (retry.json?.version?.versionNumber) entry.baseVersionNumber = retry.json.version.versionNumber;
        else if (retry.json?.unchanged) entry.baseVersionNumber = current;
        // else: retry itself failed (e.g. another concurrent bump) — leave
        // baseVersionNumber untouched and re-sync on the next iteration rather
        // than persisting a value we know to be stale.
      }
    } else if (patch.status === 404) {
      entry = undefined; // plan vanished (deleted / not owned) — fall through to a fresh push
    } else if (patch.json?.version?.versionNumber) {
      entry.baseVersionNumber = patch.json.version.versionNumber;
    }
    if (entry) reviewUrl = `${BASE}/app/documents/${entry.planId}`;
  }

  if (!entry?.planId) {
    // Idempotency-Key makes a retried create return the same plan instead of a duplicate.
    const idemKey = idempotencyKeyFor(sessionId, plan);
    const created = await api("POST", "/api/plans", { title: titleFromMarkdown(plan), markdown: plan }, { "Idempotency-Key": idemKey });
    if (created.status >= 400 || !created.json?.id) {
      // Fail CLOSED: the push failed, so the plan was not reviewed.
      refuse(
        `Consensum push failed (HTTP ${created.status}). The plan was NOT submitted for review, so I won't proceed. ` +
          `Check CONSENSUM_BASE_URL/CONSENSUM_API_TOKEN, then re-present the plan to retry.`
      );
    }
    entry = { planId: created.json.id, baseVersionNumber: 1, lastFingerprint: undefined };
    reviewUrl = created.json.reviewUrl || `${BASE}/app/documents/${entry.planId}`;
    process.stderr.write(`[consensum] Plan posted for review: ${reviewUrl}\n`);
  }
  updateState(cwd, (all) => {
    all[sessionId] = { ...entry, updatedAt: new Date().toISOString() };
  });

  // 2) Block until the team renders a verdict on THIS revision.
  const deadline = Date.now() + MAX_MS;
  while (Date.now() < deadline) {
    let fb;
    // While pending, long-poll (blocks server-side). While non-pending-but-stale
    // (a revision we already relayed, awaiting re-review), the wait endpoint
    // returns instantly, so back off with a fixed sleep before re-reading.
    const pendingProbe = await api("GET", `/api/plans/${entry.planId}/feedback`);
    if (pendingProbe.status === 404) {
      // Fail CLOSED: the plan vanished mid-review (deleted / access revoked).
      refuse(
        `Consensum plan ${entry.planId} is no longer available (HTTP 404) — it may have been deleted or access revoked. ` +
          `I won't proceed without review; re-present the plan to start a fresh review.`
      );
    }
    if (pendingProbe.json?.decision === "pending") {
      const waited = await api("GET", `/api/plans/${entry.planId}/feedback/wait?timeoutMs=${WAIT_MS}`);
      fb = waited.json || pendingProbe.json;
    } else {
      fb = pendingProbe.json;
    }

    const verdict = decide(fb, entry.lastFingerprint);
    if (verdict.action === "allow") {
      // Record WHAT was approved (not just that something was): the PostToolUse
      // backstop passes only when it sees this exact content again.
      const now = new Date().toISOString();
      updateState(cwd, (all) => {
        all[sessionId] = {
          planId: entry.planId,
          baseVersionNumber: entry.baseVersionNumber,
          approvedHash: planHash(plan),
          approvedAt: now,
          updatedAt: now,
        };
      });
      proceed();
    }
    if (verdict.action === "deny") {
      // New reviewer activity on the current version — relay it and let the agent revise.
      entry.lastFingerprint = verdict.fingerprint;
      updateState(cwd, (all) => {
        all[sessionId] = { ...entry, updatedAt: new Date().toISOString() };
      });
      refuse(buildDigest(fb, reviewUrl));
    }
    if (verdict.action === "wait") {
      // Stale: same verdict we already relayed; reviewer hasn't re-reviewed our
      // revision yet. Wait quietly.
      await new Promise((r) => setTimeout(r, STALE_POLL_MS));
      continue;
    }
    // pending and timed out: loop re-arms the long-poll.
  }

  refuse(`Plan still pending team review after the configured wait window. Re-enter plan mode and present it again when you're ready to retry. Review: ${reviewUrl}`);
}

// ---- main --------------------------------------------------------------------

async function main(input = readStdin()) {
  const isPost = input.hook_event_name === "PostToolUse";
  const proceed = isPost ? passDecision : allowDecision;
  const refuse = isPost ? blockDecision : denyDecision;

  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id || "default";
  const plan = input.tool_input?.plan;

  if (!plan) proceed(); // nothing to review
  if (SKIP) proceed(); // deliberate opt-out — honored on both events, token or not
  if (!TOKEN) {
    // Fail CLOSED: the hook is installed but misconfigured. Don't ship un-reviewed.
    refuse(
      "Consensum review is enabled (the ExitPlanMode hook is installed) but CONSENSUM_API_TOKEN is not set, " +
        "so the plan cannot be submitted for review. Set CONSENSUM_API_TOKEN (and CONSENSUM_BASE_URL) and re-present " +
        "the plan, or set CONSENSUM_SKIP=1 to deliberately bypass review for this session."
    );
  }

  let entry = loadState(cwd)[sessionId];

  // Gate<->backstop handshake: the PermissionRequest path records the approved
  // content's hash, so the PostToolUse backstop (and a re-fired gate) pass this
  // exact content without a second review round-trip.
  if (approvedMatch(entry, plan)) proceed();
  // A leftover approval for DIFFERENT content means the previous cycle is done —
  // start a fresh plan, preserving the old delete-on-approve semantics.
  if (entry?.approvedHash) entry = undefined;

  await runGate({ cwd, sessionId, plan, entry, proceed, refuse });
}

// Only run the blocking hook when executed directly (not when imported by a test).
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  const input = readStdin();
  main(input).catch((err) => {
    // FAIL CLOSED: on any unexpected failure, refuse to proceed with an
    // un-reviewed plan and surface the reason in-band to the agent.
    process.stderr.write(`[consensum] hook error: ${err?.stack || err}\n`);
    const message =
      `Consensum review hook hit an unexpected error (${err?.message || err}). ` +
      `I won't proceed without review; re-present the plan to retry, or set CONSENSUM_SKIP=1 to bypass.`;
    if (input.hook_event_name === "PostToolUse") blockDecision(message);
    else denyDecision(message);
  });
}

export { main };
