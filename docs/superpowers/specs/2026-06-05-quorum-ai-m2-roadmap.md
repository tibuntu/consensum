# Quorum AI — M2 Roadmap: Access Control & Collaboration Polish

> **Status:** Approved milestone roadmap. Each phase below runs its own `brainstorming → writing-plans → execute` cycle (same as M1's parts). This doc is the milestone-level scope + sequence, not a phase spec.
> **Follows:** M1 (Foundation + Review Core Parts 1–3 + UI Polish) — all merged to `main`.

## Theme

Make the shipped review tool safe and pleasant to actually use: close the open-access security gap, let reviewers hear about activity over email, let authors compare what changed between plan versions, and let users pick their theme.

## Phases

P1 ships first (security-critical). P2–P4 are independent (different areas) and may run in any order or in parallel sessions once P1 is merged.

### P1 · Authorization & access control  _(first — security)_
- **Problem:** Today any authenticated user (web session) or any valid API token can read or mutate **any** document/plan — there is no per-document authorization (flagged in the Part-3 final review).
- **Scope:** A shared authorization guard (e.g. `lib/authz.ts`) enforcing that only a document's **participants** — owner + anyone who authored an annotation, comment, or review on it — may read or mutate it. Applied to the web document/annotation/review/stream routes AND the machine `/api/plans` routes. Non-participants get **403** (or 404 to avoid existence leaks — decide in the phase brainstorm). Define the read-vs-edit matrix (who can comment/review vs create new versions) during the phase brainstorm.
- **Out of scope:** team/org-scoped access (that's M3); role hierarchies beyond owner/participant.
- **Depends on:** nothing. **Blocks:** nothing structurally, but should land before the others so they inherit correct access.

### P2 · Email notifications
- **Scope:** Send a **transactional** email per notification event (comment / review / version) to a document's participants, via **env-gated SMTP** (no-op when unconfigured, like the rate-limit gate). One **per-user on/off preference**. Builds directly on the existing `Notification` rows + `lib/notifications.ts` fan-out.
- **Out of scope:** digests/batching, per-event-type granularity, Slack/Teams (all M3).
- **Depends on:** P1 (only participants are emailed, and they're exactly who's authorized).

### P3 · Version history + diff view
- **Scope:** In the document view, list a document's **versions** and show a **diff** between two selected versions (e.g. previous ↔ current). Builds on Part 2's full-snapshot `DocumentVersion` records. Read-only history UI + a small versions/diff API.
- **Out of scope:** version checkpointing/compaction, restore/revert, cross-version annotation replay UI (M3).
- **Depends on:** nothing (independent of P1/P2/P4); inherits P1's access checks if landed after.

### P4 · Dark-mode toggle
- **Scope:** A user-selectable theme (light / dark / system) **persisted** across sessions, building on the UI-phase CSS-variable token system (currently OS-following only). A small theme control in the app nav.
- **Out of scope:** additional themes/palettes; per-component theming.
- **Depends on:** nothing.

## Sequence

```
P1 Authorization  ──▶  ┌── P2 Email
                       ├── P3 Version diff
                       └── P4 Dark-mode toggle   (P2/P3/P4 any order / parallel)
```

## Explicitly deferred → M3+
Teams/org model & multi-tenancy · Slack/Teams webhook notifiers · OIDC/SSO · presence + live "review together" · optional git export · version checkpointing/compaction · Postgres migration path · suggestions-as-applyable-edits · email digests + granular prefs.

## Per-phase workflow
For each phase, in a fresh session on a fresh branch off the latest `main`:
1. `brainstorming` → phase design spec in `docs/superpowers/specs/`.
2. `writing-plans` → phase implementation plan + `.tasks.json` in `docs/superpowers/plans/`.
3. `executing-plans` (or `subagent-driven-development`) → implement, verify, PR.

**Worktree/env notes carried from M1:** create an isolated worktree at execution time; this repo's pnpm v11 needs `CI=true` on script runs; free port 3000 before `pnpm test:e2e`; preserve existing `data-testid`/`aria-label` test hooks; rebase onto `main` (don't merge main in).
