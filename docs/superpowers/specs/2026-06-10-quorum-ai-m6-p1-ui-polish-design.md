# M6 · P1 — General UI Polish (Full 6-Pillar Re-Audit + Fix) — Design

> **Milestone:** M6 (Review Depth & Polish) · **Phase:** P1 · **Date:** 2026-06-10
> **Roadmap:** `docs/superpowers/specs/2026-06-10-quorum-ai-m6-roadmap.md`
> **Baseline review:** `docs/superpowers/2026-06-06-quorum-ai-ui-review.md` (scored 17/24)

## Context

M6's P1 is the long-deferred "general UI polish" phase. A fresh read of current code shows **every finding
in the 2026-06-06 UI-review is already fixed** (dark-mode prose theming, responsive document page, responsive
nav, danger contrast via `--danger-fg`, auth labels/affordances) — that debt was paid incrementally across
M2–M5. But the large surface added in **M3–M5 has never had a UI review**: presence roster, live cursors,
session banner + follow-the-leader controls, suggestion/diff cards in the comment sidebar, version history +
diff view, and the webhooks/tokens managers.

So P1 is reframed as a **full whole-app 6-pillar re-audit** — produce a fresh scored review doc covering the
M3–M5 surface too, then fix every objective finding. This re-establishes a current quality baseline and closes
real (currently unknown) polish gaps in the newer surfaces.

## Goal

1. A fresh, scored 6-pillar visual audit of the **entire** current app, directly comparable to the 17/24 baseline.
2. Fix **all objective findings** (critical → low) within the existing design system.
3. Surface **subjective / taste-call findings** as explicit decisions rather than fixing them unilaterally.

## Deliverables

1. **New review doc** `docs/superpowers/2026-06-10-quorum-ai-ui-review.md` — same rubric and format as the
   2026-06-06 doc (6 pillars × /4 → /24, headline, per-pillar `What works` + `Findings` with `[severity]` tags
   and `file:line`, top-fixes list, items-needing-human-judgment list). The 2026-06-06 doc is left intact as the
   historical baseline; the new doc notes the score delta.
2. **Code fixes** for every objective finding, committed in coherent batches.
3. **A subjective-decisions checkpoint** during execution: taste calls (e.g. brand-mark craft, landing-page
   sparseness, leading-`# H1` duplication, anything new the audit surfaces) are presented via question and only
   applied if the user chooses.

## The 6 pillars (rubric, unchanged from baseline)

| # | Pillar | What it scores |
|---|--------|----------------|
| 1 | Copywriting | Labels, microcopy, empty/guidance states, security-critical copy |
| 2 | Visuals | Identity cohesion, iconography, card/badge craft, non-generic feel |
| 3 | Color | Token discipline, semantic state colors, light+dark contrast (WCAG AA) |
| 4 | Typography | Hierarchy, markdown/prose rendering, readability in both themes |
| 5 | Spacing | Rhythm, responsive layout at 1280px and 390px, no overlap/clipping |
| 6 | Experience Design | Reachability, affordances, flows, empty/error states, mobile usability |

Each `/4`; overall `/24`.

## Audit methodology (mirrors 2026-06-06 for comparability)

- **Tooling:** Playwright (Chromium), screenshots captured to a temp dir (not committed), cross-referenced
  against source — same as the baseline run.
- **Modes × widths:** **light + dark** × **1280px (desktop) + 390px (mobile)**. Dark via the class-based
  `:root.dark` toggle (`lib/theme.ts`), not just `prefers-color-scheme`.
- **Surfaces (full inventory):**
  - Landing `app/page.tsx`; auth `app/login/page.tsx`, `app/register/page.tsx`.
  - Documents list `app/app/page.tsx`; new-document form `components/NewDocumentForm.tsx`.
  - **Document view** `components/DocumentView.tsx` — including the **M3–M5 surface**: `PresenceRoster`,
    `PresenceCursors`, `SessionBanner` (start/end session + follow-the-leader controls), and the comment
    sidebar `CommentSidebar` with **comment, suggestion, and diff cards**.
  - Version history + diff `app/app/documents/[id]/history/page.tsx`, `VersionHistory`, `lib/diff.ts` rendering.
  - Editor `components/DocumentEditor.tsx` (CodeMirror + live preview).
  - Inbox `app/app/inbox/page.tsx`, `InboxList`.
  - Settings `app/app/settings/{notifications,tokens,webhooks}` — `NotificationSettings`, `TokenManager`,
    `WebhookManager`.
- **Multi-user surfaces:** presence roster, live cursors, shared selections, and session/follow-the-leader
  require **two logged-in browser contexts** to render (one drives, one observes) — exercise these explicitly so
  they appear in screenshots.
- **Output:** score each pillar, write the findings doc.

## Fix approach

- **Triage** each finding → *objective* (one clearly-correct fix) vs *subjective* (taste).
- **Objective fixes (critical → low):** apply in place, staying within the design system —
  CSS custom properties + `@theme` tokens in `app/globals.css`, the `components/ui/*` primitives, and component
  classNames. **No raw hex** outside the token set; no new color/spacing scales.
- **Subjective items:** collected into one `AskUserQuestion` checkpoint; apply only the chosen ones.
- **Re-verify:** re-screenshot the affected surfaces in both themes × both widths after fixes; record the
  post-fix score in the review doc.

## Constraints (hard)

- **Do NOT add a Settings nav button.** Settings stays a main-nav link (`components/AppNav.tsx:8-12`) →
  `/app/settings/notifications` with the existing sub-nav (`app/app/settings/layout.tsx`).
- Stay within the **"Violet consensus"** token system — no colors/spacing outside the tokens in `globals.css`.
- **Preserve every test hook:** `data-testid`, `aria-label`, and visible button/link names. Keep
  `tests/e2e/navigation.spec.ts` and all existing e2e/unit selectors green.
- Pure libs → services → thin routes → client where any non-UI logic is touched (this phase is overwhelmingly
  client/CSS, so this rarely applies).

## Out of scope

- New features or new surfaces (this is polish only).
- Restructuring navigation/IA beyond cosmetic fixes.
- The deferred items (notification prefs = P2, quorum thresholds = P3).

## Verification

- **Automated:** `CI=true pnpm test` (unit) · free port 3000 (`lsof -ti tcp:3000 | xargs -r kill -9`) then
  `pnpm test:e2e` · `pnpm lint` · `pnpm typecheck` · production build `0/0`.
- **Manual:** re-screenshot pass — every fixed finding confirmed in **light + dark × 1280px + 390px**; the
  M3–M5 multi-user surfaces confirmed via two browser contexts; no test-hook regressions.
- **Doc:** `docs/superpowers/2026-06-10-quorum-ai-ui-review.md` exists, scores all 6 pillars, lists findings with
  severity + `file:line`, and records the post-fix score vs the 17/24 baseline.

## Worktree / env notes

Fresh worktree → bootstrap before the audit: `CI=true pnpm install`, create `.env` (set `AUTH_SECRET` to 32+
random chars), `pnpm db:migrate` / `prisma migrate deploy` + `prisma generate`. Rebased onto local `main`
(includes the M6 roadmap). Phase lands by fast-forwarding into local `main`; don't push unless asked.
