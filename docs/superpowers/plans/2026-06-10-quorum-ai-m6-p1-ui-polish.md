# M6 · P1 — General UI Polish (Full 6-Pillar Re-Audit + Fix) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a fresh whole-app 6-pillar visual audit (covering the never-reviewed M3–M5 surface), produce a scored review doc, then fix every objective finding within the existing design system.

**Architecture:** Audit-driven phase. Tasks 1–2 *discover* (bootstrap → screenshot → scored review doc with findings tagged `[severity]` + `file:line`, triaged objective vs subjective). Task 3 resolves subjective taste-calls with the user. Tasks 4–5 *fix* the objective (and chosen subjective) findings — **the specific edits are data-driven by the Task 2 review doc**, applied using the token/utility patterns shown below. Task 6 re-verifies and records the post-fix score. Fixes are CSS-/className-level within the "Violet consensus" token system; no new features, no nav restructuring.

**Tech Stack:** Next.js 16, React 19, Tailwind v4 + `@tailwindcss/typography`, design tokens in `app/globals.css` (`:root` / `:root.dark`), Playwright (Chromium) for screenshots, Vitest for unit, Prisma + SQLite.

> **Note on the "no placeholders" rule for this phase:** the exact fix diffs cannot be written before the audit runs — the findings are unknown until Task 2. Instead, Tasks 4–5 give the *fix patterns* (worked examples) and bind their acceptance criteria to the concrete findings the review doc produces. This is the correct shape for an audit→fix phase; it is not a placeholder.

---

### Task 1: Bootstrap worktree + establish green baseline

**Goal:** Get the fresh worktree runnable and capture the pre-change baseline of automated checks so later "didn't break anything" claims are trustworthy.

**Files:**
- Create: `.env` (gitignored — not committed)
- No source changes; no commit (node_modules + .env + generated client are all gitignored).

**Acceptance Criteria:**
- [ ] `CI=true pnpm install` completes; Prisma client generated (via `postinstall`).
- [ ] `.env` exists with `AUTH_SECRET` set to 32+ random chars and `BASE_URL=http://localhost:3000`.
- [ ] `pnpm db:deploy` applies migrations to `./data/app.db` cleanly.
- [ ] `pnpm build` succeeds; `pnpm start -p 3000` boots and `/login` returns 200.
- [ ] Baseline recorded: `CI=true pnpm test:unit`, `pnpm lint`, `npx tsc --noEmit` all green (note counts).

**Verify:** `CI=true pnpm test:unit` → all pass; `pnpm lint` → 0 errors; `npx tsc --noEmit` → 0 errors.

**Steps:**

- [ ] **Step 1: Install + generate client**

```bash
cd /Users/tkoller/git/private/quorumai/.claude/worktrees/m6-p1-ui-polish
CI=true pnpm install
```

- [ ] **Step 2: Create `.env`** (use full paths per shell notes; AUTH_SECRET must be 32+ chars)

```bash
/bin/cat > .env <<'ENV'
AUTH_SECRET=replace-with-32+-random-chars-xxxxxxxxxxxx
BASE_URL=http://localhost:3000
DATABASE_URL=file:./data/app.db
ENV
```
(Generate a real secret: `openssl rand -base64 32`, paste into `AUTH_SECRET`.)

- [ ] **Step 3: Apply migrations**

```bash
pnpm db:deploy
```
Expected: migrations applied, no error.

- [ ] **Step 4: Build + smoke-boot**

```bash
pnpm build
( pnpm start -p 3000 & ) ; sleep 4 ; curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/login ; lsof -ti tcp:3000 | xargs -r kill -9
```
Expected: build 0 errors; curl prints `200`.

- [ ] **Step 5: Record baseline checks**

```bash
CI=true pnpm test:unit
pnpm lint
npx tsc --noEmit
```
Expected: all green. Note the unit-test count for comparison in Task 6.

---

### Task 2: Capture screenshots + author the scored 6-pillar review doc

**Goal:** Produce `docs/superpowers/2026-06-10-quorum-ai-ui-review.md` — a fresh, scored 6-pillar audit of the whole app (incl. M3–M5 surface), with each finding tagged `[severity]` + `file:line` and triaged objective vs subjective.

**Files:**
- Create (temporary, deleted before commit): `tests/e2e/_screenshots.spec.ts`
- Create: `docs/superpowers/2026-06-10-quorum-ai-ui-review.md`
- Reference (baseline format/rubric): `docs/superpowers/2026-06-06-quorum-ai-ui-review.md`

**Acceptance Criteria:**
- [ ] Screenshots captured for every surface in the spec inventory, in **light + dark** × **1280px + 390px**.
- [ ] M3–M5 multi-user surfaces (presence roster, live cursors, shared selection, session banner + follow-the-leader) captured using **two browser contexts**.
- [ ] Review doc scores all **6 pillars** (Copywriting, Visuals, Color, Typography, Spacing, Experience Design) `/4` → `/24`, with headline, per-pillar `What works` + `Findings`, top-fixes list, and items-needing-human-judgment list — same format as the 2026-06-06 doc.
- [ ] Every finding carries a `[critical|high|medium|low]` tag, a `file:line` reference, and an **objective/subjective** classification.
- [ ] Temporary screenshot spec removed; screenshots written to a temp dir, **not committed**.

**Verify:** `test -f docs/superpowers/2026-06-10-quorum-ai-ui-review.md` and it contains a `## Score summary` table with all 6 pillars; `! test -f tests/e2e/_screenshots.spec.ts` (temp spec removed).

**Steps:**

- [ ] **Step 1: Write a temporary screenshot-capture spec** reusing the existing e2e patterns (`register()` helper, two contexts, theme toggle). It registers a user, creates a content-rich document (headings, lists, GFM table, code block, blockquote, task list), drives each surface, and at each surface captures `light`+`dark` at 1280 then 390. Dark is set via the header `ThemeToggle` (class-based `:root.dark`), not OS emulation.

```ts
// tests/e2e/_screenshots.spec.ts  (TEMPORARY — deleted at end of task)
import { test, type Page, type BrowserContext } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT = "/tmp/m6p1-shots";
mkdirSync(OUT, { recursive: true });

async function register(page: Page, name: string) {
  const email = `${name.toLowerCase()}-${Date.now()}-${Math.round(Math.random()*1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill(name);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.waitForURL(/\/app/);
  return email;
}

async function setDark(page: Page, dark: boolean) {
  // ThemeToggle cycles/sets theme; assert the html.dark class matches.
  await page.evaluate((d) => {
    localStorage.setItem("quorum-theme", d ? "dark" : "light");
    document.documentElement.classList.toggle("dark", d);
  }, dark);
}

async function shoot(page: Page, name: string) {
  for (const [w, h, tag] of [[1280, 900, "desktop"], [390, 844, "mobile"]] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const dark of [false, true]) {
      await setDark(page, dark);
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${OUT}/${name}-${tag}-${dark ? "dark" : "light"}.png`, fullPage: true });
    }
  }
}

test("capture all surfaces", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto("/");            await shoot(page, "01-landing");
  await page.goto("/login");       await shoot(page, "02-login");
  await page.goto("/register");    await shoot(page, "03-register");
  await register(page, "Ada");
  await page.goto("/app");         await shoot(page, "04-documents");
  // create a content-rich doc
  await page.getByLabel("title").fill("Audit demo");
  await page.getByLabel("markdown").fill("# Heading\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst a = 1;\n```\n\n> quote\n\n- [ ] todo");
  await page.getByRole("button", { name: /create/i }).click();
  await page.waitForURL(/\/app\/documents\//);
  await shoot(page, "05-document");
  // editor, version history, inbox, settings
  await page.goto("/app/inbox");                       await shoot(page, "08-inbox");
  await page.goto("/app/settings/notifications");      await shoot(page, "09-settings-notifications");
  await page.goto("/app/settings/tokens");             await shoot(page, "10-settings-tokens");
  await page.goto("/app/settings/webhooks");           await shoot(page, "11-settings-webhooks");

  // --- M3–M5 multi-user surface: second context joins the same doc ---
  const docUrl = page.url().includes("/documents/") ? page.url() : page.url();
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await register(pageB, "Boris");
  // Owner shares the doc with Boris by participant link/grant flow, then both open it.
  // (Use whatever the app's share mechanism is; if unavailable in UI, both view via direct URL after grant.)
  await page.goto(docUrl); await pageB.goto(docUrl);
  await pageB.waitForTimeout(1500); // let presence heartbeat + roster render
  await shoot(page, "06-presence-cursors-selection");
  // Start a review session as leader, capture session banner + follow-the-leader controls
  // (use the SessionBanner "start session" button name as it appears in components/SessionBanner.tsx)
  await shoot(page, "07-session-banner");

  await ctx.close(); await ctxB.close();
});
```
> If a share step is needed for two users to see one doc, mirror the exact mechanism used in `tests/e2e/presence.spec.ts` / `selections.spec.ts` (they already get two users into one document) — copy that setup verbatim rather than inventing one.

- [ ] **Step 2: Run the capture** (free the port first; let Playwright build+start the prod server)

```bash
lsof -ti tcp:3000 | xargs -r kill -9
pnpm exec playwright test tests/e2e/_screenshots.spec.ts --project=chromium 2>/dev/null || pnpm exec playwright test tests/e2e/_screenshots.spec.ts
ls /tmp/m6p1-shots
```
Expected: PNGs for surfaces 01–11 in `-desktop/-mobile` × `-light/-dark`.

- [ ] **Step 3: Review every screenshot** (Read tool on the PNGs) against the 6 pillars. For each surface note contrast, hierarchy, spacing/overlap/clipping at 390px, affordances, empty/error states, dark-mode legibility. Pay special attention to the **M3–M5 surfaces never previously reviewed** (presence roster, floating cursor labels, selection highlights, session banner, follow-the-leader controls, suggestion + diff cards, version-history/diff rows, webhook/token manager forms).

- [ ] **Step 4: Write the review doc** at `docs/superpowers/2026-06-10-quorum-ai-ui-review.md`, copying the section structure of the 2026-06-06 doc: front-matter (date/method/scope/baseline), `## Score summary` table (6 pillars + overall `/24`), headline, one `##` section per pillar with `What works` + `Findings`, a `## Top fixes (priority order)` list, and `## Items needing human judgment`. Tag each finding `[severity]`, cite `file:line`, and append `(objective)` or `(subjective)` to each.

- [ ] **Step 5: Clean up + commit the doc**

```bash
/bin/rm tests/e2e/_screenshots.spec.ts
git add docs/superpowers/2026-06-10-quorum-ai-ui-review.md
git commit -m "docs(m6-p1): fresh 6-pillar UI audit (whole app incl. M3-M5 surface)"
```

---

### Task 3: Subjective-decisions checkpoint

**Goal:** Resolve every `(subjective)` finding with the user via one question, and record the decisions in the review doc so Tasks 4–5 know what to apply.

**Files:**
- Modify: `docs/superpowers/2026-06-10-quorum-ai-ui-review.md` (add a `## Subjective decisions (resolved)` section)

**Acceptance Criteria:**
- [ ] Every finding tagged `(subjective)` in the review doc is presented to the user as an option (apply / leave as-is, with the recommended choice noted).
- [ ] The user's choices are recorded in a new `## Subjective decisions (resolved)` section (decision + rationale per item).
- [ ] No code changes in this task.

**Verify:** the review doc contains `## Subjective decisions (resolved)` with one line per subjective finding.

**Steps:**

- [ ] **Step 1: Collect** all `(subjective)` findings from the review doc into a single list.
- [ ] **Step 2: Ask once** via `AskUserQuestion` (multiSelect where several independent taste-calls exist) — e.g. brand-mark craft, landing-page sparseness, leading-`# H1` duplication, any newly-found taste calls. Lead each with the recommended option.
- [ ] **Step 3: Record** the decisions under `## Subjective decisions (resolved)` and commit.

```bash
git add docs/superpowers/2026-06-10-quorum-ai-ui-review.md
git commit -m "docs(m6-p1): record subjective UI decisions"
```

---

### Task 4: Fix objective findings — critical + high

**Goal:** Resolve every `(objective)` finding tagged `[critical]` or `[high]` in the review doc, within the token system, re-verifying each visually.

**Files:**
- Modify (data-driven by review doc): likely `app/globals.css`, `components/ui/*.tsx`, `components/DocumentView.tsx`, `components/CommentSidebar.tsx`, `components/SessionBanner.tsx`, `components/PresenceRoster.tsx`, `components/PresenceCursors.tsx`, `components/VersionHistory.tsx`, `components/WebhookManager.tsx`, `components/TokenManager.tsx`, `app/page.tsx`, `app/login/page.tsx`, `app/register/page.tsx` — **only the files named in the relevant findings**.

**Acceptance Criteria:**
- [ ] Every `[critical]`/`[high]` objective finding in the review doc is resolved.
- [ ] Each fix uses existing tokens/utilities — **no raw hex**, no new color/spacing scale.
- [ ] No `data-testid` / `aria-label` / visible button-or-link name changed.
- [ ] `CI=true pnpm test:unit`, `pnpm lint`, `npx tsc --noEmit` stay green.
- [ ] Each fixed surface re-screenshotted (light+dark × 1280+390) and visually confirmed.

**Verify:** `CI=true pnpm test:unit` → pass; `pnpm lint` → 0; `npx tsc --noEmit` → 0; re-shot PNGs show the finding resolved in both themes/widths.

**Steps:**

- [ ] **Step 1: Work the list** — for each `[critical]`/`[high]` objective finding, apply the matching fix pattern:
  - **Color/contrast** → replace any raw color or `text-white`-on-state with the token (`text-foreground`, `text-muted`, `text-danger-fg`, `bg-surface`, `--state-*`). Worked example (the pattern already used in `components/AppNav.tsx:34`): `bg-danger px-1.5 text-danger-fg` instead of `bg-[#...] text-white`.
  - **Responsive overlap/clip at 390px** → stack with `flex-col` + gate desktop layout behind `lg:` (pattern already in `DocumentView.tsx:616,670`: `flex w-full flex-col gap-6 lg:flex-row`; sidebar `w-full ... lg:sticky lg:w-80`). Apply the same to any newly-found cramped surface (e.g. editor 3-column, session banner, manager forms).
  - **Dark-mode prose/legibility** → ensure the surface uses `.prose` token overrides (already in `globals.css:75-95`) or token text colors; never rely on plugin defaults.
- [ ] **Step 2: Re-screenshot** the affected surfaces only (reuse the Task 2 temp-spec approach, scoped to changed surfaces) and confirm resolution; delete the temp spec after.
- [ ] **Step 3: Run checks + commit** (one commit per coherent batch, e.g. per pillar or per surface)

```bash
CI=true pnpm test:unit && pnpm lint && npx tsc --noEmit
git add -A
git commit -m "fix(m6-p1): <surface> — resolve <critical/high finding>"
```

---

### Task 5: Fix objective findings — medium + low — and chosen subjective fixes

**Goal:** Resolve every `(objective)` finding tagged `[medium]` or `[low]`, plus the subjective fixes the user approved in Task 3, within the token system.

**Files:**
- Modify (data-driven by review doc + Task 3 decisions): same candidate set as Task 4, scoped to the relevant findings.

**Acceptance Criteria:**
- [ ] Every `[medium]`/`[low]` objective finding in the review doc is resolved.
- [ ] Every subjective fix approved in Task 3's `## Subjective decisions (resolved)` is applied; rejected ones are NOT applied.
- [ ] Tokens-only; no test-hook changes; `CI=true pnpm test:unit` + `pnpm lint` + `npx tsc --noEmit` green.
- [ ] Affected surfaces re-screenshotted (light+dark × 1280+390) and visually confirmed.

**Verify:** `CI=true pnpm test:unit` → pass; `pnpm lint` → 0; `npx tsc --noEmit` → 0; re-shot PNGs confirm each fix.

**Steps:**

- [ ] **Step 1: Apply** the `[medium]`/`[low]` objective fixes using the same patterns as Task 4 (token substitution, responsive utilities, spacing rhythm via existing `gap-*`/`p-*` scale).
- [ ] **Step 2: Apply** only the Task-3-approved subjective changes.
- [ ] **Step 3: Re-screenshot** affected surfaces, confirm, delete temp spec.
- [ ] **Step 4: Run checks + commit** (coherent batches)

```bash
CI=true pnpm test:unit && pnpm lint && npx tsc --noEmit
git add -A
git commit -m "fix(m6-p1): <surface> — resolve medium/low + approved subjective findings"
```

---

### Task 6: Final verification + post-fix score

**Goal:** Prove the whole suite is green end-to-end, re-screenshot a final pass, and record the post-fix 6-pillar score against the 17/24 baseline.

**Files:**
- Modify: `docs/superpowers/2026-06-10-quorum-ai-ui-review.md` (add `## Post-fix score` + per-pillar delta)

**Acceptance Criteria:**
- [ ] `CI=true pnpm test:unit` green (count ≥ Task 1 baseline).
- [ ] `pnpm test:e2e` green (free port 3000 first).
- [ ] `pnpm lint` → 0; `npx tsc --noEmit` → 0; `pnpm build` → 0 errors / 0 warnings.
- [ ] No Settings nav button added; all `data-testid`/`aria-label`/button names intact (navigation + theme + presence + selections + suggestions e2e specs pass).
- [ ] Review doc updated with `## Post-fix score` (6 pillars + overall `/24`) and a one-line delta vs the 17/24 baseline.

**Verify:** all five commands green; `grep -c "Post-fix score" docs/superpowers/2026-06-10-quorum-ai-ui-review.md` → 1.

**Steps:**

- [ ] **Step 1: Full automated suite**

```bash
CI=true pnpm test:unit
pnpm lint
npx tsc --noEmit
pnpm build
lsof -ti tcp:3000 | xargs -r kill -9
pnpm test:e2e
```
Expected: unit pass; lint 0; tsc 0; build 0/0; e2e all pass.

- [ ] **Step 2: Final screenshot pass** (temp spec, full inventory, light+dark × 1280+390) — confirm every fixed finding resolved and nothing regressed; delete temp spec.

- [ ] **Step 3: Record post-fix score + commit**

```bash
git add docs/superpowers/2026-06-10-quorum-ai-ui-review.md
git commit -m "docs(m6-p1): record post-fix UI score + deltas vs 17/24 baseline"
```

- [ ] **Step 4: Phase landing note** — leave the branch ready to fast-forward into local `main` (do NOT push, do NOT open a PR unless asked). Report the post-fix score and the list of resolved findings.
