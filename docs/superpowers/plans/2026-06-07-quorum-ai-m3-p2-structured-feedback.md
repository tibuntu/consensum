# M3/P2 — Structured Feedback Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `GET /api/plans/[id]/feedback` into a versioned, structured, filterable JSON contract (severity/category, provenance, rollups, filtering) while keeping the existing markdown digest and top-level keys byte-stable.

**Architecture:** Extend the pure `consolidateFeedback()` (lib/feedback.ts) with the structured contract; feed it the extra data via an enlarged `getDocumentDetail` Prisma include (lib/documents.ts); the route (app/api/plans/[id]/feedback/route.ts) parses `include`/`exclude` CSV and filters `threads[]` only (rollups stay unfiltered); annotation creation gains optional `severity`/`category` (API-only affordance); the `/pull-feedback` skill leads with blockers.

**Tech Stack:** Next.js (App Router, route handlers), Prisma 7 + SQLite, Vitest (DB-backed unit suite, `CI=true`), TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-06-quorum-ai-m3-p2-structured-feedback-design.md` (status: design-final). Decisions D1–D8.

**Conventions for the implementer:**
- Value-sets live in `lib/enums.ts` — `SEVERITIES = ["BLOCKER","MAJOR","MINOR","NIT"]` already exists. Do NOT redefine.
- The unit suite hits the real Prisma/SQLite DB (see `tests/unit/annotations.test.ts`); `fileParallelism: false`. Run with `CI=true pnpm test:unit`.
- Existing route handlers validate enum membership inline (see `ANNOTATION_KINDS` in the annotations route). Mirror that pattern.
- Commit after each task. Branch is `main`; rebase onto `main` if it moved. No `Co-Authored-By` trailers.

---

### Task 1: Severity/category input affordance (API only)

**Goal:** `createAnnotation` and `POST /api/documents/[id]/annotations` accept optional `severity` (validated against `SEVERITIES`, else 400) and `category` (free-form short string), persisting them on the `Annotation` row. (D6)

**Files:**
- Modify: `lib/annotations.ts:7-33` (`createAnnotation` signature + create data)
- Modify: `app/api/documents/[id]/annotations/route.ts` (parse + validate `severity`/`category`)
- Test: `tests/unit/annotations.test.ts`

**Acceptance Criteria:**
- [ ] `createAnnotation(..., { ..., severity, category }, body)` persists `severity` and `category` on the row.
- [ ] Omitting them leaves both `null` (existing callers keep compiling and behaving identically).
- [ ] The POST route rejects a `severity` not in `SEVERITIES` with HTTP 400; accepts a valid one and any string `category`.

**Verify:** `CI=true pnpm test:unit -- annotations` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test** — append to `tests/unit/annotations.test.ts`:

```ts
import { SEVERITIES } from "@/lib/enums";

it("persists severity and category when provided", async () => {
  const now = new Date();
  const user = await prisma.user.create({ data: { id: `u-${Date.now()}-sev`, name: "U", email: `u-${Date.now()}-sev@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
  const md = "The cloud setup needs review.";
  const docId = await createDocument(user.id, "Plan", md);
  const start = md.indexOf("cloud setup");
  const ann = await createAnnotation(
    user.id,
    docId,
    { quote: buildQuote(md, start, start + "cloud setup".length), startOffset: start, endOffset: start + 11, severity: "BLOCKER", category: "security" },
    "infra concern"
  );
  const loaded = await prisma.annotation.findUnique({ where: { id: ann.id } });
  expect(loaded?.severity).toBe("BLOCKER");
  expect(loaded?.category).toBe("security");
  await prisma.document.delete({ where: { id: docId } });
});

it("defaults severity and category to null", async () => {
  const now = new Date();
  const user = await prisma.user.create({ data: { id: `u-${Date.now()}-nul`, name: "U", email: `u-${Date.now()}-nul@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
  const md = "The cloud setup needs review.";
  const docId = await createDocument(user.id, "Plan", md);
  const start = md.indexOf("cloud setup");
  const ann = await createAnnotation(user.id, docId, { quote: buildQuote(md, start, start + 11), startOffset: start, endOffset: start + 11 }, "x");
  const loaded = await prisma.annotation.findUnique({ where: { id: ann.id } });
  expect(loaded?.severity).toBeNull();
  expect(loaded?.category).toBeNull();
  await prisma.document.delete({ where: { id: docId } });
});

it("SEVERITIES is the canonical set", () => {
  expect([...SEVERITIES]).toEqual(["BLOCKER", "MAJOR", "MINOR", "NIT"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `CI=true pnpm test:unit -- annotations`
Expected: FAIL — `severity`/`category` not accepted / persisted as undefined→null mismatch (TS error on the unknown anchor keys).

- [ ] **Step 3: Extend `createAnnotation`** in `lib/annotations.ts`. Change the `anchor` param type and the `data` block:

```ts
import type { AnnotationKind, Severity, ThreadStatus } from "@/lib/enums";

export async function createAnnotation(
  userId: string,
  documentId: string,
  anchor: { quote: Quote; startOffset: number; endOffset: number; kind?: AnnotationKind; severity?: Severity | null; category?: string | null },
  body: string
) {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { currentVersionId: true } });
  if (!doc?.currentVersionId) throw new Error("document has no current version");
  const annotation = await prisma.annotation.create({
    data: {
      documentId,
      createdOnVersionId: doc.currentVersionId,
      kind: anchor.kind ?? "COMMENT",
      anchorExact: anchor.quote.exact,
      anchorPrefix: anchor.quote.prefix,
      anchorSuffix: anchor.quote.suffix,
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
      severity: anchor.severity ?? null,
      category: anchor.category ?? null,
      authorId: userId,
      comments: { create: { authorId: userId, body } },
    },
    include: { comments: { include: { author: { select: { name: true, email: true } } } }, author: { select: { name: true, email: true } } },
  });
  publish(documentId, { type: "annotation.created", annotation });
  await notifyParticipants(documentId, userId, "comment").catch(() => {});
  return annotation;
}
```

(Keep `addComment`/`setThreadStatus` unchanged. The existing `Severity` type is already exported from `lib/enums.ts`.)

- [ ] **Step 4: Validate + pass through in the POST route** `app/api/documents/[id]/annotations/route.ts`. Add the `SEVERITIES` import and validation after the `kind` block, then thread the fields into the `createAnnotation` call:

```ts
import { ANNOTATION_KINDS, SEVERITIES, type AnnotationKind, type Severity } from "@/lib/enums";

// ...after the existing `kind` derivation, before createAnnotation:
let severity: Severity | undefined;
if (body.severity != null) {
  if (typeof body.severity !== "string" || !SEVERITIES.includes(body.severity as Severity)) {
    return NextResponse.json({ error: `severity must be one of ${SEVERITIES.join(", ")}` }, { status: 400 });
  }
  severity = body.severity as Severity;
}
const category: string | undefined = typeof body.category === "string" && body.category.trim() !== "" ? body.category.trim() : undefined;

const annotation = await createAnnotation(
  user.id,
  id,
  { quote: body.quote, startOffset: body.startOffset, endOffset: body.endOffset, kind, severity, category },
  body.body
);
```

- [ ] **Step 5: Run to verify pass**

Run: `CI=true pnpm test:unit -- annotations`
Expected: PASS (all annotation tests green).

- [ ] **Step 6: Typecheck + commit**

```bash
CI=true pnpm tsc --noEmit
rtk git add lib/annotations.ts app/api/documents/[id]/annotations/route.ts tests/unit/annotations.test.ts
rtk git commit -m "feat(feedback): accept optional severity/category on annotation create (API)"
```

---

### Task 2: Fetch provenance in getDocumentDetail

**Goal:** Extend `getDocumentDetail` so each annotation carries `createdOnVersion { versionNumber }` and the document carries its ordered `versions { versionNumber, createdAt, createdBy }`. Provenance is derivable from existing rows but is not currently fetched. (D8)

**Files:**
- Modify: `lib/documents.ts:36-53` (`getDocumentDetail` include)
- Test: `tests/unit/documents.test.ts`

**Acceptance Criteria:**
- [ ] `getDocumentDetail(id)` returns `versions` ordered by `versionNumber` asc, each with `versionNumber`, `createdAt`, and `createdBy { name, email }`.
- [ ] Each entry in `.annotations` includes `createdOnVersion: { versionNumber }`.
- [ ] Existing fields (`currentVersion`, `annotations`, `reviews`, `owner`) remain present.

**Verify:** `CI=true pnpm test:unit -- documents` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test** — append to `tests/unit/documents.test.ts`:

```ts
it("getDocumentDetail exposes versions and per-annotation createdOnVersion", async () => {
  const now = new Date();
  const user = await prisma.user.create({ data: { id: `u-${Date.now()}-prov`, name: "Alex", email: `u-${Date.now()}-prov@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
  const md = "The cloud setup needs review.";
  const docId = await createDocument(user.id, "Plan", md);
  const start = md.indexOf("cloud setup");
  await createAnnotation(user.id, docId, { quote: buildQuote(md, start, start + 11), startOffset: start, endOffset: start + 11 }, "c");
  const detail = await getDocumentDetail(docId);
  expect(detail?.versions?.[0]?.versionNumber).toBe(1);
  expect(detail?.versions?.[0]?.createdBy?.name).toBe("Alex");
  expect(detail?.annotations?.[0]?.createdOnVersion?.versionNumber).toBe(1);
  await prisma.document.delete({ where: { id: docId } });
});
```

Ensure the imports at the top of `tests/unit/documents.test.ts` include `createAnnotation` (from `@/lib/annotations`) and `buildQuote` (from `@/lib/anchoring`); add them if absent.

- [ ] **Step 2: Run to verify failure**

Run: `CI=true pnpm test:unit -- documents`
Expected: FAIL — `versions` undefined / `createdOnVersion` undefined.

- [ ] **Step 3: Extend the include** in `lib/documents.ts` `getDocumentDetail`:

```ts
export async function getDocumentDetail(id: string) {
  const doc = await prisma.document.findUnique({
    where: { id },
    include: {
      currentVersion: true,
      owner: { select: { name: true, email: true } },
      versions: {
        orderBy: { versionNumber: "asc" },
        select: { versionNumber: true, createdAt: true, createdBy: { select: { name: true, email: true } } },
      },
      annotations: {
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { name: true, email: true } },
          createdOnVersion: { select: { versionNumber: true } },
          comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true, email: true } } } },
        },
      },
      reviews: { include: { reviewer: { select: { name: true, email: true } } } },
    },
  });
  return doc;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `CI=true pnpm test:unit -- documents`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
CI=true pnpm tsc --noEmit
rtk git add lib/documents.ts tests/unit/documents.test.ts
rtk git commit -m "feat(feedback): fetch version provenance in getDocumentDetail"
```

---

### Task 3: Structured contract in consolidateFeedback

**Goal:** Extend `consolidateFeedback()` to emit `schemaVersion: 1`, enriched `threads[]` (`severity`, `category`, `anchorState`, `raisedOnVersion`), `currentVersion`, `versions[]`, and `rollup{}`; add a pure `filterThreads()` helper; reorder markdown to lead with BLOCKER/unresolved. Keep `decision`/`state`/`markdown`/`threads`/`reviews` backward-compatible. (D1, D2, D5, D7, rollups)

**Files:**
- Modify: `lib/feedback.ts` (whole file — interface, function, new helper)
- Test: `tests/unit/feedback.test.ts`

**Contract reference (matches spec API surface):**

```ts
export interface FeedbackThread {
  id: string;
  quote: string | null;
  kind: string;
  status: string;               // anchor status (existing key, kept)
  threadStatus: string;
  severity: string | null;
  category: string | null;
  anchorState: string;          // alias of status, named per spec
  raisedOnVersion: number | null;
  comments: { author: string; body: string }[];
}
export interface FeedbackRollup {
  blocking: number;             // severity === "BLOCKER"
  unresolved: number;           // threadStatus === "OPEN"
  total: number;
  byCategory: Record<string, number>;   // null category -> "uncategorized"
  byVersion: Record<string, number>;    // keyed by raisedOnVersion (string)
}
```

**Filter tags (D4/D7):** `blocking` = `severity === "BLOCKER"`; `unresolved` = `threadStatus === "OPEN"`; `resolved` = `threadStatus === "RESOLVED"`; `orphaned` = `anchorState === "ORPHANED"`.

**Acceptance Criteria:**
- [ ] Return object adds `schemaVersion: 1`, `currentVersion`, `versions`, `rollup`, and enriched `threads[]`; existing `decision`, `state`, `markdown`, `reviews` keys unchanged in shape.
- [ ] `rollup.blocking` counts only `severity === "BLOCKER"`; null severity never blocking. `rollup.unresolved` counts `threadStatus === "OPEN"`. `rollup.byCategory` buckets null category as `"uncategorized"`. `rollup.byVersion` keyed by `raisedOnVersion` as string.
- [ ] `filterThreads(threads, { include, exclude })` returns the subset; an empty/absent filter returns all; `exclude` wins over `include` for the same tag.
- [ ] Markdown lists BLOCKER threads first, then other unresolved (OPEN) threads, then the rest; the no-comment and verdict sections still render. Existing test assertions (`"No inline comments"`, quote/comment substrings, verdict) still pass — regression guard.
- [ ] For the legacy input shape (no severity/category/version data), `decision`, `state`, and the set of pre-existing markdown lines remain stable (the three original tests pass unchanged).

**Verify:** `CI=true pnpm test:unit -- feedback` → all pass.

**Steps:**

- [ ] **Step 1: Write failing tests** — append to `tests/unit/feedback.test.ts`:

```ts
import { consolidateFeedback, filterThreads } from "@/lib/feedback";

const baseThread = (over: Partial<Parameters<typeof consolidateFeedback>[0]["annotations"][number]> = {}) => ({
  id: "ann_1", anchorExact: "cloud setup", kind: "COMMENT", status: "ACTIVE", threadStatus: "OPEN",
  severity: null, category: null, createdOnVersion: { versionNumber: 1 },
  comments: [{ body: "which provider?", author: { name: "Sam" } }], ...over,
});

it("stamps schemaVersion and structured fields", () => {
  const r = consolidateFeedback({
    state: "CHANGES_REQUESTED",
    currentVersion: { versionNumber: 4 },
    versions: [{ versionNumber: 4, createdAt: new Date(0), createdBy: { name: "Alex" } }],
    annotations: [baseThread({ id: "ann_a", severity: "BLOCKER", category: "security", createdOnVersion: { versionNumber: 4 } })],
    reviews: [{ verdict: "REQUEST_CHANGES", dismissed: false, reviewer: { name: "Sam" } }],
  });
  expect(r.schemaVersion).toBe(1);
  expect(r.currentVersion).toBe(4);
  expect(r.versions[0]).toMatchObject({ number: 4, createdBy: "Alex" });
  expect(r.threads[0]).toMatchObject({ id: "ann_a", severity: "BLOCKER", category: "security", anchorState: "ACTIVE", raisedOnVersion: 4 });
});

it("computes rollups; null severity not blocking, null category bucketed", () => {
  const r = consolidateFeedback({
    state: "CHANGES_REQUESTED",
    currentVersion: { versionNumber: 2 },
    versions: [{ versionNumber: 1, createdAt: new Date(0), createdBy: { name: "A" } }, { versionNumber: 2, createdAt: new Date(0), createdBy: { name: "A" } }],
    annotations: [
      baseThread({ id: "a1", severity: "BLOCKER", category: "security", threadStatus: "OPEN", createdOnVersion: { versionNumber: 2 } }),
      baseThread({ id: "a2", severity: null, category: null, threadStatus: "OPEN", createdOnVersion: { versionNumber: 1 } }),
      baseThread({ id: "a3", severity: "NIT", category: "naming", threadStatus: "RESOLVED", createdOnVersion: { versionNumber: 1 } }),
    ],
    reviews: [],
  });
  expect(r.rollup.blocking).toBe(1);
  expect(r.rollup.unresolved).toBe(2);
  expect(r.rollup.total).toBe(3);
  expect(r.rollup.byCategory).toEqual({ security: 1, uncategorized: 1, naming: 1 });
  expect(r.rollup.byVersion).toEqual({ "1": 2, "2": 1 });
});

it("filterThreads honors include/exclude; exclude wins", () => {
  const r = consolidateFeedback({
    state: "CHANGES_REQUESTED", currentVersion: { versionNumber: 1 },
    versions: [{ versionNumber: 1, createdAt: new Date(0), createdBy: { name: "A" } }],
    annotations: [
      baseThread({ id: "b", severity: "BLOCKER", threadStatus: "OPEN" }),
      baseThread({ id: "n", severity: "NIT", threadStatus: "RESOLVED", status: "ACTIVE" }),
      baseThread({ id: "o", severity: "MAJOR", threadStatus: "OPEN", status: "ORPHANED" }),
    ],
    reviews: [],
  });
  expect(filterThreads(r.threads, { include: ["blocking"] }).map((t) => t.id)).toEqual(["b"]);
  expect(filterThreads(r.threads, { include: ["unresolved"], exclude: ["orphaned"] }).map((t) => t.id)).toEqual(["b"]);
  expect(filterThreads(r.threads, {}).map((t) => t.id)).toEqual(["b", "n", "o"]);
});

it("markdown leads with blocker then unresolved", () => {
  const r = consolidateFeedback({
    state: "CHANGES_REQUESTED", currentVersion: { versionNumber: 1 },
    versions: [{ versionNumber: 1, createdAt: new Date(0), createdBy: { name: "A" } }],
    annotations: [
      baseThread({ id: "nit", anchorExact: "typo", severity: "NIT", threadStatus: "RESOLVED" }),
      baseThread({ id: "blk", anchorExact: "secret in code", severity: "BLOCKER", threadStatus: "OPEN" }),
    ],
    reviews: [],
  });
  expect(r.markdown.indexOf("secret in code")).toBeLessThan(r.markdown.indexOf("typo"));
});
```

The three pre-existing tests in this file pass `{ state, annotations, reviews }` with annotations lacking the new fields — they MUST keep passing. Update the existing inline annotation objects ONLY if TypeScript requires the new fields; make the new `FeedbackDetail` fields optional so legacy inputs compile unchanged.

- [ ] **Step 2: Run to verify failure**

Run: `CI=true pnpm test:unit -- feedback`
Expected: FAIL — `filterThreads` not exported / `schemaVersion` undefined / rollup undefined.

- [ ] **Step 3: Rewrite `lib/feedback.ts`** to the structured contract (new fields optional on input for backward compat):

```ts
import { getDocumentDetail } from "@/lib/documents";

type Author = { name?: string | null; email?: string | null } | null;

interface DetailAnnotation {
  id?: string;
  anchorExact: string | null;
  kind?: string;
  status: string;
  threadStatus: string;
  severity?: string | null;
  category?: string | null;
  createdOnVersion?: { versionNumber: number } | null;
  comments: { body: string; author?: Author }[];
}
interface DetailVersion { versionNumber: number; createdAt?: Date | string; createdBy?: Author }

export interface FeedbackDetail {
  state: string;
  currentVersion?: { versionNumber: number } | null;
  versions?: DetailVersion[];
  annotations: DetailAnnotation[];
  reviews: { verdict: string; dismissed: boolean; reviewer?: Author }[];
}

export interface FeedbackThread {
  id: string;
  quote: string | null;
  kind: string;
  status: string;
  threadStatus: string;
  severity: string | null;
  category: string | null;
  anchorState: string;
  raisedOnVersion: number | null;
  comments: { author: string; body: string }[];
}

export type Decision = "pending" | "approved" | "changes_requested";

function decisionFor(state: string): Decision {
  if (state === "CHANGES_REQUESTED") return "changes_requested";
  if (state === "APPROVED") return "approved";
  return "pending";
}

function authorName(a: Author): string {
  return a?.name ?? a?.email ?? "someone";
}

const FILTER_TAGS = ["blocking", "unresolved", "resolved", "orphaned"] as const;
type FilterTag = (typeof FILTER_TAGS)[number];

function hasTag(t: FeedbackThread, tag: FilterTag): boolean {
  switch (tag) {
    case "blocking": return t.severity === "BLOCKER";
    case "unresolved": return t.threadStatus === "OPEN";
    case "resolved": return t.threadStatus === "RESOLVED";
    case "orphaned": return t.anchorState === "ORPHANED";
  }
}

export function filterThreads(
  threads: FeedbackThread[],
  opts: { include?: string[]; exclude?: string[] }
): FeedbackThread[] {
  const include = (opts.include ?? []).filter((t): t is FilterTag => (FILTER_TAGS as readonly string[]).includes(t));
  const exclude = (opts.exclude ?? []).filter((t): t is FilterTag => (FILTER_TAGS as readonly string[]).includes(t));
  return threads.filter((t) => {
    if (exclude.some((tag) => hasTag(t, tag))) return false;
    if (include.length && !include.some((tag) => hasTag(t, tag))) return false;
    return true;
  });
}

function rank(t: FeedbackThread): number {
  if (t.severity === "BLOCKER") return 0;
  if (t.threadStatus === "OPEN") return 1;
  return 2;
}

export function consolidateFeedback(detail: FeedbackDetail) {
  const threads: FeedbackThread[] = detail.annotations.map((a) => ({
    id: a.id ?? "",
    quote: a.anchorExact,
    kind: a.kind ?? "COMMENT",
    status: a.status,
    threadStatus: a.threadStatus,
    severity: a.severity ?? null,
    category: a.category ?? null,
    anchorState: a.status,
    raisedOnVersion: a.createdOnVersion?.versionNumber ?? null,
    comments: a.comments.map((c) => ({ author: authorName(c.author ?? null), body: c.body })),
  }));
  const reviews = detail.reviews.map((r) => ({ reviewer: authorName(r.reviewer ?? null), verdict: r.verdict, dismissed: r.dismissed }));
  const decision = decisionFor(detail.state);

  const byCategory: Record<string, number> = {};
  const byVersion: Record<string, number> = {};
  for (const t of threads) {
    const cat = t.category ?? "uncategorized";
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    if (t.raisedOnVersion != null) {
      const v = String(t.raisedOnVersion);
      byVersion[v] = (byVersion[v] ?? 0) + 1;
    }
  }
  const rollup = {
    blocking: threads.filter((t) => t.severity === "BLOCKER").length,
    unresolved: threads.filter((t) => t.threadStatus === "OPEN").length,
    total: threads.length,
    byCategory,
    byVersion,
  };

  const versions = (detail.versions ?? []).map((v) => ({
    number: v.versionNumber,
    createdBy: authorName(v.createdBy ?? null),
    createdAt: v.createdAt instanceof Date ? v.createdAt.toISOString() : (v.createdAt ?? null),
  }));

  // markdown: lead with BLOCKER, then unresolved, then the rest (stable within rank)
  const ordered = threads.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((x) => x.t);
  const lines: string[] = [`# Review feedback — decision: ${decision}`, ""];
  if (ordered.length === 0) lines.push("_No inline comments._", "");
  for (const t of ordered) {
    const sev = t.severity ? `[${t.severity}] ` : "";
    const tags = `${t.status === "ORPHANED" ? " (orphaned)" : t.status === "MOVED" ? " (moved)" : ""}${t.threadStatus === "RESOLVED" ? " [resolved]" : ""}`;
    lines.push(`## ${sev}On "${t.quote ?? "(unanchored)"}"${tags}`);
    for (const c of t.comments) lines.push(`- **${c.author}:** ${c.body}`);
    lines.push("");
  }
  if (reviews.length) {
    lines.push("## Verdicts");
    for (const r of reviews) lines.push(`- ${r.reviewer}: ${r.verdict}${r.dismissed ? " (dismissed)" : ""}`);
  }

  return {
    schemaVersion: 1 as const,
    decision,
    state: detail.state,
    markdown: lines.join("\n"),
    currentVersion: detail.currentVersion?.versionNumber ?? null,
    versions,
    rollup,
    threads,
    reviews,
  };
}

export async function getPlanFeedback(documentId: string, filter?: { include?: string[]; exclude?: string[] }) {
  const detail = await getDocumentDetail(documentId);
  if (!detail) return null;
  const consolidated = consolidateFeedback(detail as unknown as FeedbackDetail);
  if (filter && (filter.include?.length || filter.exclude?.length)) {
    return { ...consolidated, threads: filterThreads(consolidated.threads, filter) };
  }
  return consolidated;
}
```

Note: markdown now prefixes a `[SEVERITY]` tag when present. The three legacy tests assert `toContain("cloud setup")`, `toContain("which provider?")`, `toContain("No inline comments")`, verdict — all still satisfied (substrings unaffected by the prefix and reordering). If any legacy test asserted an exact full-string match it would need updating, but they use `toContain`.

- [ ] **Step 4: Run to verify pass**

Run: `CI=true pnpm test:unit -- feedback`
Expected: PASS (legacy + new tests).

- [ ] **Step 5: Typecheck + commit**

```bash
CI=true pnpm tsc --noEmit
rtk git add lib/feedback.ts tests/unit/feedback.test.ts
rtk git commit -m "feat(feedback): structured contract — schemaVersion, rollups, provenance, filtering"
```

---

### Task 4: Wire filtering into the feedback route + integration test

**Goal:** Parse `include`/`exclude` CSV query params on `GET /api/plans/[id]/feedback`, pass them to `getPlanFeedback` (filters `threads[]` only; rollups stay unfiltered). Add a DB-backed integration test proving the end-to-end contract. (D4 + spec e2e intent)

**Files:**
- Modify: `app/api/plans/[id]/feedback/route.ts`
- Test: `tests/unit/feedback.test.ts` (DB-backed integration block — depends on Tasks 1 & 2)

**Acceptance Criteria:**
- [ ] `?include=blocking,unresolved&exclude=resolved` parses into string arrays passed to `getPlanFeedback`; absent params → no filtering.
- [ ] The response's `rollup` reflects unfiltered totals even when `include`/`exclude` shrink `threads[]`.
- [ ] Integration: a doc with one BLOCKER thread + one NIT (RESOLVED) + REQUEST_CHANGES yields `rollup.blocking === 1`, `rollup.total === 2`; filtering `include=["blocking"]` returns exactly the BLOCKER thread while rollup still shows totals.

**Verify:** `CI=true pnpm test:unit -- feedback` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing integration test** — append to `tests/unit/feedback.test.ts` (add imports `prisma`, `createDocument`, `createAnnotation`, `buildQuote`, `getPlanFeedback` as needed):

```ts
import { getPlanFeedback } from "@/lib/feedback";
import { prisma } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { createAnnotation, setThreadStatus } from "@/lib/annotations";
import { buildQuote } from "@/lib/anchoring";

it("getPlanFeedback: rollups stay unfiltered while threads are filtered", async () => {
  const now = new Date();
  const user = await prisma.user.create({ data: { id: `u-${Date.now()}-fb`, name: "Alex", email: `u-${Date.now()}-fb@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
  const md = "Store the secret in code? Also a tiny typo here.";
  const docId = await createDocument(user.id, "Plan", md);
  const s1 = md.indexOf("secret in code");
  await createAnnotation(user.id, docId, { quote: buildQuote(md, s1, s1 + 14), startOffset: s1, endOffset: s1 + 14, severity: "BLOCKER", category: "security" }, "no secrets in code");
  const s2 = md.indexOf("typo");
  const nit = await createAnnotation(user.id, docId, { quote: buildQuote(md, s2, s2 + 4), startOffset: s2, endOffset: s2 + 4, severity: "NIT", category: "naming" }, "typo");
  await setThreadStatus(user.id, nit.id, "RESOLVED");
  await prisma.document.update({ where: { id: docId }, data: { state: "CHANGES_REQUESTED" } });

  const all = await getPlanFeedback(docId);
  expect(all?.rollup.blocking).toBe(1);
  expect(all?.rollup.total).toBe(2);

  const filtered = await getPlanFeedback(docId, { include: ["blocking"] });
  expect(filtered?.threads).toHaveLength(1);
  expect(filtered?.threads[0].severity).toBe("BLOCKER");
  expect(filtered?.rollup.total).toBe(2); // unfiltered totals preserved
  await prisma.document.delete({ where: { id: docId } });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `CI=true pnpm test:unit -- feedback`
Expected: FAIL — `getPlanFeedback` does not yet accept a filter arg (this was added in Task 3; if Task 3 already shipped it, this test passes the lib path and only the route wiring remains — still write the route change below).

- [ ] **Step 3: Parse query params in the route** `app/api/plans/[id]/feedback/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { getPlanFeedback } from "@/lib/feedback";
import { isOwner } from "@/lib/authz";

function csv(v: string | null): string[] | undefined {
  if (!v) return undefined;
  const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authd = await requireApiUser(req);
  if (!authd) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isOwner(authd.user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!authd.scopes.includes("feedback:read")) return NextResponse.json({ error: "insufficient scope" }, { status: 403 });
  const url = new URL(req.url);
  const include = csv(url.searchParams.get("include"));
  const exclude = csv(url.searchParams.get("exclude"));
  const feedback = await getPlanFeedback(id, { include, exclude });
  if (!feedback) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(feedback);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `CI=true pnpm test:unit -- feedback`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
CI=true pnpm tsc --noEmit
rtk git add app/api/plans/[id]/feedback/route.ts tests/unit/feedback.test.ts
rtk git commit -m "feat(feedback): include/exclude filtering on feedback route; rollups unfiltered"
```

---

### Task 5: Update /pull-feedback skill to lead with blockers

**Goal:** Update the skill instructions so an agent reads `schemaVersion`, leads with `rollup.blocking`/`rollup.unresolved`, groups threads by severity, and can focus a revision pass via `?include=blocking,unresolved`. Behaviour on `decision == pending` unchanged. (D3)

**Files:**
- Locate & Modify: the `/pull-feedback` skill file (search: `pull-feedback`). Per the marketplace skill list it is `pull-feedback`; the editable instruction file is most likely under `.claude/commands/pull-feedback.md`. If it is not under the repo (lives in a plugin cache, read-only), instead create/update the repo-local copy the spec names: `.claude/commands/pull-feedback.md`.

**Acceptance Criteria:**
- [ ] Instructions branch on `schemaVersion >= 1`: present `rollup.blocking` and `rollup.unresolved` first, then group threads by `severity` (BLOCKER → MAJOR → MINOR → NIT → null).
- [ ] Documents the optional `?include=blocking,unresolved` focus call.
- [ ] States that `decision == pending` behaviour is unchanged and that the legacy `markdown` field remains available for callers that haven't been updated.

**Verify:** Manual read-through — `rtk read .claude/commands/pull-feedback.md` shows the schemaVersion branch and the blocker-first ordering. (No automated test; this is agent-facing prose.)

**Steps:**

- [ ] **Step 1: Locate the file**

```bash
rtk grep -n "pull-feedback\|feedback" .claude/commands 2>/dev/null
ls -la .claude/commands 2>/dev/null
```

If `.claude/commands/pull-feedback.md` exists, edit it. If the active skill lives only in the plugin cache (read-only), create the repo-local `.claude/commands/pull-feedback.md` capturing the new flow (the spec explicitly references this path).

- [ ] **Step 2: Update / write the instructions** so they include, near the top of the "after fetching feedback" section:

```markdown
## Reading the structured contract (schemaVersion >= 1)

The feedback endpoint returns a versioned JSON contract. Branch on `schemaVersion`:

- If `schemaVersion >= 1`:
  1. **Lead with the rollup.** State `rollup.blocking` (must-fix) and `rollup.unresolved` (open threads) before anything else, then `rollup.byCategory`.
  2. **Group threads by `severity`** in order BLOCKER → MAJOR → MINOR → NIT → (null/unset last). Within each group show `quote`, the latest comment, `category`, and `raisedOnVersion`.
  3. To focus only on must-fix items during a revision pass, call
     `GET /api/plans/<id>/feedback?include=blocking,unresolved`. Rollups in the
     response always reflect unfiltered totals, so you still see the true picture.
- If `schemaVersion` is absent (legacy server): fall back to rendering the `markdown` field as today.

`decision == "pending"` behaviour is unchanged: report that no decision has been
reached and summarize open threads. The `markdown` field remains available for
backward compatibility.
```

- [ ] **Step 3: Commit**

```bash
rtk git add .claude/commands/pull-feedback.md
rtk git commit -m "docs(feedback): /pull-feedback leads with blockers on schemaVersion>=1"
```

---

## Self-Review

**Spec coverage:** D1 (schemaVersion) → Task 3. D2 (severity source + null handling) → Tasks 1, 3. D3 (backward compat + skill) → Tasks 3, 5. D4 (filtering, blocking=BLOCKER) → Tasks 3, 4. D5 (provenance) → Tasks 2, 3. D6 (severity input API) → Task 1. D7 (null buckets) → Task 3. D8 (data fetching) → Task 2. Rollups → Task 3. Filtering route → Task 4. Skill → Task 5. Testing strategy (unit + DB-backed integration) → Tasks 1–4. ✅ No gaps.

**Note on "E2e":** the spec's e2e (push → annotate → REQUEST_CHANGES → pull) is realized as a DB-backed integration test in the Vitest suite (Task 4), matching this repo's convention of DB-backed "unit" tests (`tests/unit/annotations.test.ts`) rather than driving the HTTP route through Playwright (which would require API-token auth plumbing not present in the e2e harness). This is a deliberate, lighter-weight realization of the same intent.

**Placeholder scan:** none — every code step shows full content.

**Type consistency:** `FeedbackThread` (id, quote, kind, status, threadStatus, severity, category, anchorState, raisedOnVersion, comments) defined in Task 3 and consumed identically by `filterThreads` and the route in Task 4. `getPlanFeedback(documentId, filter?)` signature defined in Task 3, called with the same shape in Task 4. `createAnnotation` anchor opts (severity/category) defined in Task 1 and used in Tasks 2 & 4 tests. Consistent.

**Dependencies:** Task 3 depends on Task 2 (needs `createdOnVersion`/`versions` in detail) and Task 1 (tests create annotations with severity). Task 4 depends on Tasks 1, 2, 3. Task 5 depends on Task 4 (documents the query param). Tasks 1 and 2 are independent of each other.
