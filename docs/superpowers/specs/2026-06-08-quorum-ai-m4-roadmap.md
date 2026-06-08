# Quorum AI — M4 Roadmap: Governance, Lifecycle & Notification Polish

> **Status:** Approved milestone roadmap. Each phase below runs its own `brainstorming → writing-plans → execute` cycle (same as M1/M2/M3 phases). This doc is the milestone-level scope + sequence, not a phase spec.
> **Follows:** M3 (durable outbox + structured feedback contract + block-until-approved + webhooks + suggestions-as-edits + OIDC) — all shipped on `main`.

## Theme

M1 made review work; M2 made it safe and pleasant; M3 sharpened the agent-in-the-loop moat. M4 tightens the **governance, lifecycle, and awareness** edges that show up once people actually use the loop daily:

- **Governance** — you can't rubber-stamp your own plan (today a document owner can approve their own document), and review verdicts belong to *other* participants.
- **Lifecycle** — you can remove a plan/document you own (there is no delete capability today at all).
- **Operator control** — plans are agent-driven, so human UI editing becomes an operator choice, gated by an env flag (default on, unchanged behavior).
- **Awareness** — notifications become live and OS-level: a tab-title unread count and native Web Notifications, instead of a count computed once at page load.

It also fixes a visible bug: resolved comments leave their yellow in-text highlight behind.

None of M4 touches the big deferred items (Postgres/multi-instance, multi-tenancy, presence, git export, Slack/Teams formatters, enforced-SSO/SCIM) — those stay deferred to M5+.

## Phases

All three phases are independent and may run in any order or in parallel sessions. Suggested order: the resolved-marker bug fix in **P2** first (a quick, visible win), then **P1** (governance), then **P2**'s edit flag, then **P3** (the largest). P3 is the most code; P1 is mostly server-side authz.

### P1 · Ownership governance
- **Problem:** `submitReview()` (`lib/reviews.ts:8`) is gated only by `isParticipant()` — there is **no owner check**, so a document owner can approve (or otherwise issue a verdict on) their own document. Separately, there is **no way to delete a document/plan** at all — no route, no service function, no UI.
- **Scope:**
  - **Block all owner verdicts.** Reject with **403** when `isOwner(user.id, documentId)` before recording any verdict (APPROVE / REQUEST_CHANGES / COMMENT), at the `POST /api/documents/[id]/reviews` route and/or in `submitReview()`. Review verdicts are for other participants only. Comment threads/annotations are unaffected — this is strictly the verdict model. Document-state computation is unchanged; the owner is simply kept out of the reviewer set.
  - **Owner-only hard delete.** New `DELETE /api/documents/[id]` gated by `isOwner`. Removes the document; cascades wipe versions, annotations, comments, reviews, notifications, and participants. UI: a delete control on the document view behind a confirmation dialog, then redirect to the document list.
- **Out of scope:** admin/moderator roles (delete stays strictly owner-only); soft-delete / recovery / trash (hard delete only); quorum/N-approver thresholds for the approved state (state computation unchanged — we only remove the owner from reviewers).
- **Implementation risk to handle in the plan:** annotations carry `onDelete: Restrict` backrefs to `DocumentVersion` (`createdOnVersion`, `appliedInVersion`). A naive document delete can hit a Restrict violation. Delete in dependency order inside a transaction (annotations → versions → document) or relax those specific FKs to cascade — decide in the phase plan, with a test that deleting a document with applied suggestions succeeds.
- **Depends on:** nothing.

### P2 · UI polish & gating
- **Problem:** (a) Plans are agent-driven, but the UI exposes human editing unconditionally; some operators want to disable it. (b) When a comment thread is RESOLVED, its yellow in-text highlight marker still renders — the marker component doesn't consult thread state.
- **Scope:**
  - **Edit-UI feature flag (UI-only, default ON).** New env var `EDIT_UI_ENABLED` (defaults to `true` → behavior unchanged). Add `isEditUiEnabled()` to a `lib/config.ts`, following the `isEmailConfigured()` / `isOidcConfigured()` (`Boolean(env...)`) pattern. When off, hide the edit affordance in `DocumentView`; the `PATCH /api/documents/[id]` route **stays functional** for machine/API callers (deliberately UI-only gating). Thread the flag from the server layout to the client the same way `unread` / theme are passed today. Document the new var in `.env.example` + README.
  - **Resolved-marker bug fix.** `applyHighlights()` (`lib/highlight.ts`) wraps annotation ranges in a `<mark>` regardless of thread state, and `DocumentView.tsx:113` builds the range list without checking `threadStatus`. Fix: exclude `threadStatus === "RESOLVED"` annotations from the highlight ranges so the in-text marker **disappears entirely** when a thread is resolved (the comment remains accessible in the sidebar, which already dims resolved threads to `opacity-50`). Add a regression test.
- **Out of scope:** gating the edit API for machine callers; a richer "read-only mode" banner; restyling resolved markers (they are removed, not recolored).
- **Depends on:** nothing.

### P3 · Live notifications
- **Problem:** The in-app unread count is computed once, server-side, at layout load (`app/app/layout.tsx` → `unreadCount(userId)`); there is no live update and no browser/OS surfacing. Users miss new comments/reviews/decisions unless they reload.
- **Scope:**
  - **Global per-user SSE stream.** New `GET /api/notifications/stream` reusing the `lib/events.ts` bus to push per-user notification events in real time. A client-side provider subscribes app-wide (one connection per tab).
  - **Tab-title unread count.** Drive `document.title = "(N) Quorum AI"` from the live unread count; revert to the plain title at zero.
  - **Web Notifications API.** Request permission gracefully (on a user gesture / when first enabled, not on first paint), and fire a native OS notification **only when `document.visibilityState === 'hidden'`**, deduped against already-seen notification IDs. The tab-title count updates regardless of focus.
- **Out of scope:** push to devices when no tab is open (that's M3's webhooks territory for CI); per-notification rich actions; notification preferences UI beyond the existing email on/off (a global enable/disable for OS notifications is fine; granular per-type is deferred).
- **Depends on:** nothing structurally (reuses the existing event bus).

> **Added mid-milestone (2026-06-08), after P1–P3 implemented** — two operational items surfaced during implementation.

### P4 · Health & readiness probes
- **Problem:** No health endpoint exists; containers/k8s can't tell if the process is alive or able to serve (DB reachable). Dockerfile/compose have no healthcheck. No middleware, so probe routes are reachable unauthenticated.
- **Scope:** `GET /healthz` (liveness — dependency-free 200) and `GET /readyz` (readiness — cheap `SELECT 1`, 200/503) at app root; k8s startup probe reuses `/readyz`. Add `HEALTHCHECK` to Dockerfile + `healthcheck` to compose (Node `fetch` one-liner; slim image has no curl). Document probe paths + a k8s probe snippet in README.
- **Out of scope:** worker/queue health, metrics endpoint, maintained k8s manifests/Helm.
- **Depends on:** nothing.

### P5 · Generic env vars (hard rename)
- **Problem:** `BETTER_AUTH_URL` / `BETTER_AUTH_SECRET` leak better-auth's library naming into operator-facing deployment config.
- **Scope:** Hard rename → `BASE_URL` / `AUTH_SECRET`. Wire them into `betterAuth()` explicitly (`secret`/`baseURL` — the library auto-reads the old names today, so the rename requires explicit wiring). DRY the four ad-hoc base-URL reads behind a `baseUrl()` helper in `lib/config.ts`. Update `.env.example`, `docker-compose.yml`, `.github/workflows/ci.yml`, README.
- **Out of scope:** a full zod-validated env module; backward-compat aliases (it's a hard rename); renaming unrelated vars.
- **Depends on:** nothing.

## Sequence

```
P2 resolved-marker bug fix   (quick win — can land first / standalone)
P1 Ownership governance      ┐
P2 Edit-UI feature flag      ├── all independent; any order / parallel
P3 Live notifications        │
P4 Health & readiness probes │
P5 Generic env vars          ┘
```

## Explicitly deferred → M5+
Postgres migration & multi-instance · teams/org model & multi-tenancy · presence + live "review together" · optional git export · dedicated Slack/Teams message formatters · enforced-SSO / multiple-provider / SCIM · admin/moderator roles · soft-delete / trash / recovery · quorum / N-approver thresholds · version checkpointing/compaction · multi-hunk suggestion patches · granular per-type notification preferences.

## Per-phase workflow
For each phase, in a fresh session on a fresh branch off the latest `main`:
1. `brainstorming` → phase design spec in `docs/superpowers/specs/`.
2. `writing-plans` → phase implementation plan + `.tasks.json` in `docs/superpowers/plans/`.
3. `executing-plans` (or `subagent-driven-development`) → implement, verify, PR.

**Worktree/env notes carried from M1–M3:** create an isolated worktree at execution time; this repo's pnpm v11 needs `CI=true` on script runs; free port 3000 before `pnpm test:e2e`; preserve existing `data-testid`/`aria-label` test hooks; rebase onto `main` (don't merge main in); pure libs → services → thin routes → client; value-sets in `lib/enums.ts`.
