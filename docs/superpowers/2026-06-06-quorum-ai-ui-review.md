# Quorum AI — UI Review (6-Pillar Visual Audit)

> **Date:** 2026-06-06
> **Method:** Live screenshots captured via Playwright (Chromium) in **light + system-dark** at 1280px, plus a 390px narrow pass — cross-referenced against source.
> **Scope:** Holistic — the whole app UI (landing, auth, documents list, document view, comment thread, editor, inbox, settings/tokens), assessed against general 6-pillar standards.
> **Design intent baseline:** "Violet consensus" — `docs/superpowers/specs/2026-06-05-quorum-ai-ui-polish-design.md`; tokens in `app/globals.css`.

## Score summary

| Pillar | Score |
|--------|-------|
| Copywriting | 4/4 |
| Visuals | 3/4 |
| Color | 2/4 |
| Typography | 3/4 |
| Spacing | 2/4 |
| Experience Design | 3/4 |
| **Overall** | **17/24** |

**Headline:** In **light mode on desktop** this is a genuinely polished, cohesive product — strong copy, a real token system, and excellent markdown typography. Two systemic defects pull the score down hard: **(1) the rendered-markdown body is unreadable in dark mode**, and **(2) the document page is broken on mobile widths**. Both hit the app's core surface (reviewing a plan), so they outweigh how good the rest looks.

---

## 1. Copywriting — 4/4

**What works**
- Landing hero is sharp and on-message: *"Pull-request review, but for the plan — before the agent builds."* with a clear sub-line explaining the loop (agent drafts → team reviews → feedback flows back).
- Action labels are unambiguous and verb-first: `Get started`, `Approve`, `Request changes`, `Create document`, `Create token`, `Resolve`/`Reopen`.
- Empty/guidance states are written, not blank: `No documents yet — create one below.`, `No notifications.`, `Select text in the document to add a comment.`
- Security-critical microcopy is correct: token reveal says *"Copy this token now — it won't be shown again."* and the CLI-setup snippet tells the user exactly what to do next (`app/app/settings/tokens` / `TokenManager.tsx`).

**Findings** — none material. Copy is consistent and confident throughout.

---

## 2. Visuals — 3/4

**What works**
- Cohesive "Violet consensus" identity: `◆ Quorum` wordmark, soft rounded cards (`Card.tsx`), pill badges, and a consistent primitive set (`components/ui/`) give the app a unified, non-generic feel.
- Document state is communicated visually with semantic badges (amber `Open`, green `Approved`) — see documents list and review bar.
- Code blocks and inline-code chips are tastefully themed (`app/globals.css` prose overrides).

**Findings**
- `[low]` The brand mark is a literal `◆` glyph rather than real iconography; nav links are text-only (no icons, no favicon-grade mark). Fine for M1 but it's the ceiling on "craft." — `components/AppNav.tsx:18`
- `[low]` The landing page is very sparse — a vertically centered hero on a large empty canvas with no header nav, supporting visual, or footer. Reads as unfinished rather than minimal. — `app/page.tsx` *(needs_human_review: brand feel)*

---

## 3. Color — 2/4

**What works**
- Disciplined token system: a single `:root` set with a `prefers-color-scheme: dark` override, exposed to Tailwind v4 via `@theme inline` (`app/globals.css`). No raw hex smeared across components.
- Semantic state colors (`--state-open/changes/approved/neutral` + `-bg`) flip correctly between modes, so **badges read well in both light and dark**.
- Light-mode palette is well-balanced; muted secondary text (`#6b6780` on `#faf9fc`) measures ≈5.2:1 — passes WCAG AA.

**Findings**
- `[critical]` **Rendered markdown is unreadable in dark mode.** The `.prose` container is never themed for dark, so `@tailwindcss/typography` falls back to its light-theme text colors — dark headings, bold, table headers, and blockquotes render nearly invisibly on the dark surface. Confirmed in both the document view and the editor preview pane (`dark-06`, `dark-08`). The UI-polish design contract explicitly called for *"prose (+ dark:prose-invert equivalent via tokens) … tune prose color vars to the palette"* — this was not done. — `app/globals.css` (no `--tw-prose-*` overrides), `components/DocumentView.tsx:280`, `components/DocumentEditor.tsx` preview pane.
- `[medium]` **Danger button fails contrast in dark mode.** `danger: "bg-[var(--state-changes)] text-white"` — in dark mode `--state-changes` becomes light red `#fca5a5`, so `Request changes` / `Revoke` render as white text on a pale red fill (≈1.4:1). — `components/ui/Button.tsx:10`
- `[low]` Same `text-white` on `--state-changes` issue affects the unread-count badge in the nav. — `components/AppNav.tsx:31`

---

## 4. Typography — 3/4

**What works**
- Geist sans/mono throughout with a clear hierarchy (page H1 `text-2xl font-semibold`, section headings, muted secondary text).
- **Light-mode markdown rendering is excellent** — the prior UI-polish work shows: headed sections, ordered lists, GFM task lists with aligned accent checkboxes, inline-code chips, themed fenced code blocks, clean tables, and styled blockquotes all render beautifully (`light-06`). This is the strongest part of the UI.
- Editor uses a syntax-highlighted CodeMirror pane with a live typeset preview (`light-08`).

**Findings**
- `[high]` The dark-mode heading/bold/quote color failure (see Color → critical) is also a typographic failure: the type hierarchy effectively disappears in dark mode.
- `[low]` Author-supplied markdown that starts with `# Title` renders an H1 identical to the page-level title, producing a visible duplicate heading on the document view. Consider de-emphasizing or de-duplicating. — `components/DocumentView.tsx:268,282`

---

## 5. Spacing — 2/4

**What works**
- Desktop rhythm is good: consistent card padding (`p-6`/`p-3`/`p-4`), comfortable nav height, sensible `gap-*` between sections, and a centered max-width content column.
- Auth cards and the documents grid (`sm:grid-cols-2`) are well-proportioned on desktop and collapse cleanly to one column on mobile (`narrow-04`).

**Findings**
- `[high]` **The document page is broken on mobile.** The layout is a fixed flex row — `flex w-full gap-6` with a `w-80 shrink-0` sidebar and no responsive stacking — so at 390px the body column is crushed to ~40px (text wraps one word per line) and the sticky sidebar overlaps the document. The core review screen is unusable on phones. — `components/DocumentView.tsx:265,287`
- `[medium]` **Nav header overflows on narrow viewports.** The single justified row (wordmark + 3 links + full email + Sign out) doesn't wrap or truncate, so a long email pushes `Sign out` to clip/wrap (`narrow-04`). The design doc anticipated "collapses to a simple row on small screens" — it doesn't collapse gracefully. — `components/AppNav.tsx:16,39`
- `[low]` In edit mode at ≤~1280px the three columns (CodeMirror + preview + sidebar) get cramped and the editor pane clips content horizontally (`light-08`).

---

## 6. Experience Design — 3/4

**What works**
- **Navigation reachability is solved** — Documents / Inbox / Settings are all in the header with active-state highlighting and an unread-count badge hook; there's even a regression test (`tests/e2e/navigation.spec.ts`).
- The **select-to-comment** flow is clear: selecting text opens a composer; the resulting thread quotes the anchored text and offers `Reply` / `Resolve` (`light-07`). Good affordances for the product's central interaction.
- Token lifecycle is handled correctly: one-time reveal, "Never used" status, `Revoke`, and a copy-paste CLI setup block.
- Empty states exist for documents and inbox.

**Findings**
- `[high]` Mobile experience of the document page is broken (see Spacing) — the primary task can't be completed on a phone.
- `[low]` Auth secondary links (`Need an account? Sign up`, `Already have an account? Log in`) render as plain muted text with no color/underline, so they don't read as links. — `app/login/page.tsx`, `app/register/page.tsx`
- `[low]` Form fields are placeholder-only (no persistent visible labels); labels vanish on input. Accessible names exist via `aria-label`, but a visible label improves usability. — `components/ui/Input.tsx` usages, `NewDocumentForm.tsx`

---

## Top fixes (priority order)

1. **[critical] Theme `prose` for dark mode.** Add `--tw-prose-*` overrides (headings, body, bold, quotes, captions, th/td borders → `--foreground`/`--muted`/`--border`) under the dark block in `app/globals.css`, or apply a token-driven `prose-invert` to the rendered-markdown containers. Verify in both `DocumentView` body and `DocumentEditor` preview.
2. **[high] Make the document page responsive.** Stack on small screens: `flex-col lg:flex-row`, sidebar `w-full lg:w-80`, and gate `sticky` behind `lg:` so it doesn't overlap on mobile. (`components/DocumentView.tsx:265,287`)
3. **[medium] Fix danger / unread-badge contrast in dark mode.** Don't hardcode `text-white` on `--state-changes`; use a foreground that stays legible when the token flips to light-red (e.g. a dark fg in dark mode, or a dedicated `--danger-fg` token). (`components/ui/Button.tsx:10`, `components/AppNav.tsx:31`)
4. **[medium] Make the nav header responsive.** Allow the row to wrap and truncate the email (`max-w` + `truncate`), or collapse links on narrow widths so nothing clips. (`components/AppNav.tsx`)
5. **[low] Strengthen auth-link affordance and field labels.** Style the Sign-up/Log-in links as real links (primary color / underline) and consider visible field labels.

## Items needing human judgment
- Brand feel of the `◆ Quorum` wordmark and the sparseness of the landing page (Visuals).
- Whether to de-duplicate the leading H1 in rendered documents vs. accept it as user content (Typography).

---

*Note: this is a non-GSD project (no `.planning/`), so the audit was run directly rather than via the `gsd-ui-auditor` subagent. Screenshots were captured to a temp directory and not committed.*
