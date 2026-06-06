# Quorum AI — Build Status & Resume Guide

_Snapshot for pausing/resuming. Quorum AI = "PR review for the **plan**, before the agent builds." Full design: `docs/superpowers/specs/2026-06-04-quorum-ai-design.md`._

## Milestones

### M1 — Review Core + Packaging + UI  ✅ shipped (all merged to `main`)

| Phase | Plan | PR |
|-------|------|----|
| Foundation | `plans/2026-06-04-quorum-ai-foundation.md` | merged |
| CI & Docker | `plans/2026-06-04-quorum-ai-ci-and-docker.md` | merged |
| Review Core pt 1 (documents/annotations/threads/verdicts) | `plans/2026-06-04-quorum-ai-review-core.md` | #16 |
| Review Core pt 2 (versioning/re-anchoring/live SSE) | `plans/2026-06-05-quorum-ai-review-core-part-2.md` | #17 |
| Review Core pt 3 (machine API/feedback/notifications/packaging) | `plans/2026-06-05-quorum-ai-review-core-part-3.md` | #18 |
| UI Polish ("Violet consensus") | `plans/2026-06-05-quorum-ai-ui-polish.md` | #19 |

The full hero loop works: `/push-plan` → team review (annotate, thread, resolve, verdict) → `/pull-feedback`, with editing→versions + re-anchoring, live SSE, in-app notifications, Bearer-token machine API, and a production-grade themed UI. ~30 unit tests + e2e (auth, review, versioning, integration, navigation) green; Docker/compose packaged.

### M2 — Access Control & Collaboration Polish  📋 roadmap defined, not started

Roadmap: `specs/2026-06-05-quorum-ai-m2-roadmap.md`. Phases (P1 first; P2–P4 parallelizable after):
- **P1 · Authorization** — per-document/plan access (owner + participants) on web + machine API. _Security-critical; closes the Part-3 open-access gap._
- **P2 · Email notifications** — transactional, env-gated SMTP, per-user on/off.
- **P3 · Version history + diff view** — browse versions + diff in the document view.
- **P4 · Dark-mode toggle** — user-selectable persisted theme.

Deferred → M3+: teams/org & multi-tenancy · Slack/Teams webhooks · OIDC/SSO · presence/live · git export · version checkpointing · Postgres · suggestions-as-edits · email digests.

## Git state
- `main`: all M1 work merged (PRs #16–#19) + this roadmap.
- No active feature branches locally. Merged feature branches may still exist on `origin` (cleanup optional). User manages pushes.

## Run locally
```
cp .env.example .env          # set BETTER_AUTH_SECRET to 32+ random chars
CI=true pnpm install
pnpm db:migrate               # apply migrations to ./data/app.db
pnpm dev                      # http://localhost:3000
```
Container: `BETTER_AUTH_SECRET=$(openssl rand -base64 32) docker compose up`.

## Next action
Start **M2 / P1 (Authorization)** — fresh session on a fresh branch off `main`: `brainstorming` → `writing-plans` → execute (see the roadmap's "Per-phase workflow").

## Env/workflow notes (carried from M1)
- This repo's **pnpm is v11** → prefix script runs with `CI=true` (avoids the no-TTY `node_modules` purge abort).
- **Free port 3000** before `pnpm test:e2e` (`lsof -ti tcp:3000 | xargs -r kill -9`) so the webServer rebuilds.
- **Preserve test selectors** (`data-testid`/`aria-label`/button names) when touching UI.
- Create an isolated worktree at execution time; **rebase onto `main`** (don't merge main in).
- Pure libs → services → thin routes → client; value-sets in `lib/enums.ts`.

## Known follow-ups / deferrals
- Add indexes on author/reviewer FK columns (`Annotation.authorId`, `Comment.authorId`, `Review.reviewerId`, `DocumentVersion.createdById`).
- README quickstart still references pre-M1 state — update to the real `docker compose up` + agent-loop flow.
- A `gsd-ui-review` visual audit of the shipped UI is in progress (separate session).
