# Quorum AI — Review Core Part 2: Versioning & Live Collaboration (Design)

> **Status:** Approved design. Next step: `writing-plans` → implementation plan.
> **Builds on:** Review Core Part 1 (documents, annotations, threads, verdicts) — merged to `main`.

## Goal

A logged-in reviewer can **edit a document's markdown** to produce a new version; every existing annotation is **re-anchored** against the new text and classified `ACTIVE` / `MOVED` / `ORPHANED`; any content change **resets prior approvals**; and all changes (annotations, comments, verdicts, new versions) propagate **live** to other viewers of the same document over SSE — all in the browser.

## Scope

**In scope (this spec):**
1. In-app markdown **editing → new `DocumentVersion`** (explicit save, optimistic concurrency).
2. Cross-version **re-anchoring** with `ACTIVE` / `MOVED` / `ORPHANED` status + orphan UI.
3. **Approval dismissal** on any content change.
4. Converting `Annotation.createdOnVersionId` / `Review.onVersionId` to real **foreign keys**.
5. **Live SSE** updates via in-memory per-document pub/sub.

**Out of scope (future):**
- Browsing / diffing **historical versions** (UI always operates on the current version).
- **Integration & packaging** (machine API, `/push-plan` / `/pull-feedback`, notifications, Dockerfile/`output: standalone` resolution) → a separate Part 3 plan.
- Multi-instance scaling of the event bus (Redis/broker) — the in-memory bus is correct for the current single-instance deployment; revisit at packaging time.

## Decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Version creation | **Explicit Save = 1 version.** `PATCH /api/documents/:id` with `baseVersionNumber`; **409** if stale. | Clean reviewable history; re-anchor runs once per save; matches Part 1's deferred note. |
| Re-anchoring | **ACTIVE / MOVED / ORPHANED.** Exact/context → ACTIVE; fuzzy ≥ threshold → MOVED; else ORPHANED. | Preserves comments through nearby edits without silently mis-placing them. |
| Approval reset | **Any content change dismisses all active APPROVE reviews.** | Conservative, unambiguous, safe for a review tool; no fragile "editorial" heuristic. |
| Live updates | **In-memory per-document pub/sub + SSE;** client merges, refetches on reconnect. | Fits single-instance SQLite/standalone deployment; no external broker. |
| Editor | **CodeMirror 6** (`@uiw/react-codemirror` + `@codemirror/lang-markdown`) split-pane with live preview. | Syntax highlighting + good large-doc ergonomics for editing markdown source. |

## Architecture

Same layering as Part 1: **pure libs** (unit-tested, no I/O) → **service modules** (DB + orchestration, unit-tested) → **thin API routes** (auth + parse + delegate) → **client components**.

### Schema & migration
- Convert `Annotation.createdOnVersionId` → relation `createdOnVersion DocumentVersion @relation("AnnotationVersion", fields: [createdOnVersionId], references: [id], onDelete: Restrict)`.
- Convert `Review.onVersionId` → relation `onVersion DocumentVersion @relation("ReviewVersion", fields: [onVersionId], references: [id], onDelete: Restrict)`.
- Add the inverse relation arrays on `DocumentVersion`.
- `onDelete: Restrict` because versions are append-only and never deleted in this milestone.
- No new columns: `Annotation.status` (default `ACTIVE`) and `Review.dismissed` (default `false`) already exist; `ANCHOR_STATUSES = ["ACTIVE","MOVED","ORPHANED"]` already in `lib/enums.ts`.
- New Prisma migration; existing rows backfill cleanly (their version ids already point at real `DocumentVersion` rows).

### `lib/anchoring.ts` (extend — pure)
- Add `relocate(text: string, quote: Quote, opts?: { threshold?: number }): { status: AnchorStatus; range: TextRange | null }`.
  - **ACTIVE:** existing `locate()` resolves (exact unique, or context-disambiguated).
  - **MOVED:** exact not found, but a fuzzy match scores ≥ `threshold` (default `0.7`).
  - **ORPHANED:** no acceptable match → `{ status: "ORPHANED", range: null }`.
- Fuzzy matcher is **dependency-free**: normalized Levenshtein similarity (`1 - dist/maxLen`) over candidate windows of `~exact.length`, scanned across the text; ties broken by prefix/suffix context overlap (reuse Part 1's `commonPrefixLen` / `commonSuffixLen`). Keep `CONTEXT`/threshold as named constants.
- Existing `buildQuote` / `locate` / `Quote` / `TextRange` unchanged (back-compatible).

### `lib/events.ts` (new — in-memory pub/sub)
- Module-global `EventEmitter` guarded on `globalThis` (same pattern as `lib/db.ts`) so it survives Next dev HMR and is shared across route handlers in the process.
- `publish(documentId: string, event: DocEvent): void`
- `subscribe(documentId: string, handler: (e: DocEvent) => void): () => void` (returns unsubscribe).
- `DocEvent` discriminated union on `type`:
  `annotation.created` · `comment.created` · `annotation.updated` (status/threadStatus) · `review.updated` (carries new doc `state`) · `version.created` (carries new `versionNumber` + re-anchor summary).
- Pure-ish (no DB); unit-testable by subscribing, publishing, asserting delivery + unsubscribe.

### `lib/versions.ts` (new — service)
- `createVersion(userId, documentId, baseVersionNumber, markdown)`:
  1. Load `currentVersion`; if `currentVersion.versionNumber !== baseVersionNumber` → throw `ConcurrencyError` (route maps to **409**).
  2. If `sha256(markdown)` equals current `contentHash` → **no-op**, return `{ unchanged: true }` (route returns 200, no new version).
  3. Create `DocumentVersion` `vN+1`; set `document.currentVersionId`.
  4. **Re-anchor:** for each annotation, build a `Quote` from its stored `anchor{Exact,Prefix,Suffix}`, run `relocate(newMarkdown, quote)`; update `startOffset`/`endOffset`/`status` (and refresh prefix/suffix for ACTIVE/MOVED to keep context current).
  5. **Dismiss approvals:** set `dismissed = true` on all active `APPROVE` reviews for the document.
  6. Recompute `document.state` via `computeDocumentState`.
  7. `publish(documentId, { type: "version.created", versionNumber, summary })`.
  8. Return new version + re-anchor summary (counts per status).
- Existing mutation services gain a `publish(...)` call after their successful write:
  `createAnnotation` → `annotation.created`; `addComment` → `comment.created`; `setThreadStatus` → `annotation.updated`; `submitReview` → `review.updated` (with recomputed state).

### API routes (thin, `requireUser`-guarded)
- `PATCH /api/documents/[id]` → parse `{ baseVersionNumber: number, markdown: string }`; call `createVersion`; **409** on `ConcurrencyError`; 400 on bad body; return `{ version, summary }` (or `{ unchanged: true }`).
- `GET /api/documents/[id]/stream` → SSE. Return a `ReadableStream` with `Content-Type: text/event-stream`; on start `subscribe()` and write each event as `data: ${JSON.stringify(event)}\n\n`; send a `: heartbeat\n\n` comment every ~25s; call unsubscribe + clear heartbeat on `cancel`.

### UI
- **`DocumentView`** gains a read/review ↔ **edit** toggle (state: `mode`).
  - **Edit mode:** `<DocumentEditor>` (CodeMirror 6 split-pane: source left, live `react-markdown` preview right) bound to a local markdown buffer + a *Save* button. Save → `PATCH` with `{ baseVersionNumber, markdown }`. On **409** → inline "This document changed since you started editing. Reload to get the latest." On success → adopt returned version, exit edit mode, re-apply highlights.
  - **Status rendering:** `ACTIVE` highlight unchanged; `MOVED` highlight gets a small "moved" badge/title; `ORPHANED` annotations get **no inline mark** and render in a dimmed **"Orphaned comments"** section in `CommentSidebar` (thread still fully readable/repliable).
  - **SSE:** open `EventSource("/api/documents/:id/stream")` on mount; merge incoming events into `annotations` / comments / `docState`; on `version.created` from another client → refetch detail. On `error` → close, refetch detail, resubscribe (simple backoff). Cleanup on unmount.
- **`CommentSidebar`** gains the orphaned section + a `status` indicator per thread.

## Data flow

**Save (versioning):**
`Editor → PATCH → createVersion` → concurrency check → new version → re-anchor (relocate per annotation) → dismiss approvals → recompute state → `publish(version.created)` → response updates the saving client; other clients receive SSE → refetch.

**Live (any mutation):**
`service write → publish(documentId, event)` → bus → each subscribed `/stream` handler writes the SSE frame → client merges into state.

## Error handling

| Case | Behavior |
|---|---|
| Stale `baseVersionNumber` | 409; client shows reload prompt; no version created. |
| Unchanged content on save | 200 `{ unchanged: true }`; no new version, no re-anchor, no approval reset. |
| SSE connection drop | Client closes, refetches detail (authoritative), resubscribes. |
| Orphaned annotation | Preserved (never deleted); highlight removed; shown in orphaned section. |
| Invalid PATCH body | 400. |
| Unauthenticated | 401 (all routes). |

## Testing strategy

**Unit (Vitest):**
- `tests/unit/anchoring.relocate.test.ts` — ACTIVE (unchanged + context-moved), MOVED (nearby edit, score ≥ threshold), ORPHANED (text deleted), threshold boundary.
- `tests/unit/events.test.ts` — publish delivers to subscribers of that doc only; unsubscribe stops delivery.
- `tests/unit/versions.test.ts` — 409 on stale base; no-op on unchanged content; re-anchor classifies ACTIVE/MOVED/ORPHANED; active approvals dismissed + state recomputed; `version.created` published.

**E2E (Playwright):** `tests/e2e/versioning.spec.ts`
- Create doc + annotate → edit so the annotated phrase shifts → save → comment still attached, thread shows MOVED.
- Edit to delete the annotated phrase → save → thread appears in the Orphaned section, no inline mark.
- Approve → edit content → save → state badge returns to "Open".
- Two browser contexts on the same doc → context A adds a comment → context B sees it appear live (SSE) without reload.

## Components & build order (units)

1. **Schema FK migration** — convert version-id fields to relations; new migration.
2. **`lib/anchoring.relocate` + fuzzy** (TDD, pure). *(independent)*
3. **`lib/events` pub/sub** (TDD). *(independent)*
4. **`lib/versions.createVersion`** + re-anchor + approval dismissal (TDD). *(blocked by 1, 2)*
5. **`PATCH /api/documents/[id]`** + publish-wiring into existing services. *(blocked by 3, 4)*
6. **`GET /api/documents/[id]/stream`** SSE route. *(blocked by 3)*
7. **Editor UI** (CodeMirror split-pane, save, 409 prompt) in `DocumentView`. *(blocked by 5)*
8. **SSE client merge + MOVED/ORPHANED UI** in `DocumentView` / `CommentSidebar`. *(blocked by 6, 7)*
9. **E2E** versioning + live spec. *(blocked by 7, 8)*

## Conventions (carried from Part 1)

- Plain commit messages, **no `Co-Authored-By` / AI attribution trailer**.
- Shell has SCM Breeze — use Write/Edit (not heredocs) and single-line Bash; prefer `command git` if the breeze wrapper interferes.
- Next 16 route handlers receive `params` as a Promise (`const { id } = await params`).
- Deterministic logic in pure libs; DB in services; routes stay thin.
- Value-set constants in `lib/enums.ts`.
- Work on a feature branch; rebase onto `main` (do not merge main in) if it advances.
