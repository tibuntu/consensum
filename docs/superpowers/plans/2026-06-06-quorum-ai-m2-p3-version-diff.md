# M2/P3 — Version History + Diff View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only `/history` route per document that lists all versions and shows a split, side-by-side diff of the markdown source between any two selected versions.

**Architecture:** Pure server-side diff (`lib/diff.ts`, jsdiff) producing a side-by-side row model; read helpers on `lib/versions.ts`; a server-rendered route that gates on participation and computes the diff; a presentational client component for the version list + diff pane. No write surface.

**Tech Stack:** Next.js 16 App Router, Prisma 7 + SQLite, `diff` (jsdiff), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-06-quorum-ai-m2-p3-version-diff-design.md`

**Execution notes:** `CI=true` prefix on scripts/installs; rebase onto `main` (no merges); no `Co-Authored-By` trailer.

---

### Task 1: Diff engine (`lib/diff.ts`)

**Goal:** Pure function turning two markdown strings into a side-by-side row model with intra-line word highlighting on changed rows.

**Files:**
- Create: `lib/diff.ts`
- Modify: `package.json` (+ `diff`, `@types/diff`)
- Test: `tests/unit/diff.test.ts`

**Acceptance Criteria:**
- [ ] Identical inputs → every row `unchanged`, line numbers aligned on both sides.
- [ ] Pure addition produces `added` rows (no `oldNumber`); pure removal produces `removed` rows (no `newNumber`).
- [ ] A modified line yields a `changed` row carrying both texts and `wordSpans` for old and new.

**Verify:** `CI=true pnpm test:unit tests/unit/diff.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Install diff**

```bash
CI=true pnpm add diff && CI=true pnpm add -D @types/diff
```

- [ ] **Step 2: Write the failing test**

`tests/unit/diff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { diffMarkdown } from "../../lib/diff";

it("identical inputs are all unchanged", () => {
  const rows = diffMarkdown("a\nb\nc", "a\nb\nc");
  expect(rows.every((r) => r.kind === "unchanged")).toBe(true);
  expect(rows.map((r) => [r.oldNumber, r.newNumber])).toEqual([[1,1],[2,2],[3,3]]);
});

it("pure addition", () => {
  const rows = diffMarkdown("a\nb", "a\nb\nc");
  const added = rows.filter((r) => r.kind === "added");
  expect(added).toHaveLength(1);
  expect(added[0].newText).toBe("c");
  expect(added[0].oldNumber).toBeUndefined();
});

it("pure removal", () => {
  const rows = diffMarkdown("a\nb\nc", "a\nc");
  const removed = rows.filter((r) => r.kind === "removed");
  expect(removed).toHaveLength(1);
  expect(removed[0].oldText).toBe("b");
});

it("modified line yields changed row with word spans", () => {
  const rows = diffMarkdown("the quick fox", "the slow fox");
  const changed = rows.find((r) => r.kind === "changed");
  expect(changed).toBeTruthy();
  expect(changed!.oldText).toBe("the quick fox");
  expect(changed!.newText).toBe("the slow fox");
  expect(changed!.newSpans?.some((s) => s.added && s.value.includes("slow"))).toBe(true);
});
```

- [ ] **Step 3: Run to verify it fails** — module missing → FAIL.

- [ ] **Step 4: Implement `lib/diff.ts`**

```ts
import { diffLines, diffWords } from "diff";

export interface WordSpan { value: string; added?: boolean; removed?: boolean; }
export interface DiffRow {
  kind: "unchanged" | "added" | "removed" | "changed";
  oldNumber?: number;
  newNumber?: number;
  oldText?: string;
  newText?: string;
  oldSpans?: WordSpan[];
  newSpans?: WordSpan[];
}

/** Side-by-side diff of two markdown sources, line-based with intra-line word spans. */
export function diffMarkdown(oldText: string, newText: string): DiffRow[] {
  const parts = diffLines(oldText, newText);
  const rows: DiffRow[] = [];
  let oldNo = 1, newNo = 1;

  // Buffer consecutive removed/added blocks so adjacent removed+added pair into "changed".
  let pendingRemoved: string[] = [];
  let pendingAdded: string[] = [];

  const flushPair = () => {
    const n = Math.max(pendingRemoved.length, pendingAdded.length);
    for (let i = 0; i < n; i++) {
      const o = pendingRemoved[i]; const a = pendingAdded[i];
      if (o !== undefined && a !== undefined) {
        const words = diffWords(o, a);
        rows.push({
          kind: "changed", oldNumber: oldNo++, newNumber: newNo++, oldText: o, newText: a,
          oldSpans: words.filter((w) => !w.added).map((w) => ({ value: w.value, removed: w.removed })),
          newSpans: words.filter((w) => !w.removed).map((w) => ({ value: w.value, added: w.added })),
        });
      } else if (o !== undefined) {
        rows.push({ kind: "removed", oldNumber: oldNo++, oldText: o });
      } else if (a !== undefined) {
        rows.push({ kind: "added", newNumber: newNo++, newText: a });
      }
    }
    pendingRemoved = []; pendingAdded = [];
  };

  const splitLines = (s: string): string[] => {
    const arr = s.split("\n");
    if (arr.length > 1 && arr[arr.length - 1] === "") arr.pop(); // trailing newline artifact
    return arr;
  };

  for (const part of parts) {
    const lines = splitLines(part.value);
    if (part.added) { pendingAdded.push(...lines); continue; }
    if (part.removed) { pendingRemoved.push(...lines); continue; }
    flushPair();
    for (const line of lines) rows.push({ kind: "unchanged", oldNumber: oldNo++, newNumber: newNo++, oldText: line, newText: line });
  }
  flushPair();
  return rows;
}
```

- [ ] **Step 5: Run to verify it passes** — `... → PASS`.

- [ ] **Step 6: Commit**

```bash
git add lib/diff.ts package.json pnpm-lock.yaml tests/unit/diff.test.ts
git commit -m "feat(diff): side-by-side markdown diff engine with word spans"
```

---

### Task 2: Version read helpers (`lib/versions.ts`)

**Goal:** Add `listVersions` (metadata, newest-first) and `getVersionMarkdown` (single snapshot) without touching `createVersion`.

**Files:**
- Modify: `lib/versions.ts`
- Test: `tests/unit/versions.test.ts` (extend)

**Acceptance Criteria:**
- [ ] `listVersions(documentId)` returns `{ versionNumber, createdAt, createdBy: {name}, contentHash }[]` ordered by `versionNumber` desc.
- [ ] `getVersionMarkdown(documentId, versionNumber)` returns the markdown string, or `null` if absent.

**Verify:** `CI=true pnpm test:unit tests/unit/versions.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test**

In `tests/unit/versions.test.ts`, add (reuse the file's existing doc/version setup helpers):

```ts
it("listVersions returns metadata newest-first", async () => {
  // create a doc with 2 versions via existing helpers → docId
  const list = await listVersions(docId);
  expect(list.map((v) => v.versionNumber)).toEqual([2, 1]);
  expect(list[0].createdBy.name).toBeTruthy();
});

it("getVersionMarkdown returns snapshot or null", async () => {
  expect(await getVersionMarkdown(docId, 1)).toContain("v1 content");
  expect(await getVersionMarkdown(docId, 999)).toBeNull();
});
```

Add the imports for `listVersions`, `getVersionMarkdown` to the test's import line.

- [ ] **Step 2: Run to verify it fails** — exports missing → FAIL.

- [ ] **Step 3: Implement the helpers** in `lib/versions.ts`

```ts
export async function listVersions(documentId: string) {
  return prisma.documentVersion.findMany({
    where: { documentId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true, createdAt: true, contentHash: true, createdBy: { select: { name: true } } },
  });
}

export async function getVersionMarkdown(documentId: string, versionNumber: number): Promise<string | null> {
  const v = await prisma.documentVersion.findUnique({
    where: { documentId_versionNumber: { documentId, versionNumber } },
    select: { markdown: true },
  });
  return v?.markdown ?? null;
}
```

(Uses the existing `@@unique([documentId, versionNumber])` compound key.)

- [ ] **Step 4: Run to verify it passes** — `... → PASS`.

- [ ] **Step 5: Commit**

```bash
git add lib/versions.ts tests/unit/versions.test.ts
git commit -m "feat(versions): listVersions + getVersionMarkdown read helpers"
```

---

### Task 3: Versions list API (`/api/documents/[id]/versions`)

**Goal:** Participant-gated GET returning the version list, mirroring the document GET auth pattern.

**Files:**
- Create: `app/api/documents/[id]/versions/route.ts`
- Test: `tests/e2e/version-history.spec.ts` (asserts 404 for non-participant; full UI flow in Task 5)

**Acceptance Criteria:**
- [ ] Returns `{ versions: [...] }` for a participant.
- [ ] 401 when unauthenticated; 404 when the caller is not a participant / doc absent (no existence leak).

**Verify:** `CI=true pnpm test:e2e tests/e2e/version-history.spec.ts` → PASS

**Steps:**

- [ ] **Step 1: Implement the route** (mirror `app/api/documents/[id]/route.ts` GET)

`app/api/documents/[id]/versions/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { ensureParticipant } from "@/lib/authz";
import { listVersions } from "@/lib/versions";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await ensureParticipant(user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const versions = await listVersions(id);
  return NextResponse.json({ versions });
}
```

(Read access uses `ensureParticipant` exactly like the document detail GET — link-grant on read.)

- [ ] **Step 2: Add the non-participant 404 e2e case**

Create `tests/e2e/version-history.spec.ts` with a first test (the UI test is added in Task 5):

```ts
import { test, expect, request } from "@playwright/test";
// follow existing e2e helpers for registering users A and B and getting B's session cookie

test("non-participant gets 404 on versions API", async ({ browser }) => {
  // user A creates a doc → docId (via UI or machine API helper used elsewhere)
  // user B (no link) calls GET /api/documents/<docId>/versions
  // expect 404
});
```

- [ ] **Step 3: Run + commit**

```bash
CI=true pnpm test:e2e tests/e2e/version-history.spec.ts
git add app/api/documents/[id]/versions/route.ts tests/e2e/version-history.spec.ts
git commit -m "feat(versions): participant-gated versions list API"
```

---

### Task 4: History route + diff component

**Goal:** A read-only `/app/documents/[id]/history` page that lists versions, selects a from/to pair (defaulting to the latest pair), and renders a responsive split diff.

**Files:**
- Create: `app/app/documents/[id]/history/page.tsx`
- Create: `components/VersionHistory.tsx`
- Test: covered by `tests/e2e/version-history.spec.ts` (Task 5)

**Acceptance Criteria:**
- [ ] Page gates with `ensureParticipant` → `notFound()` for non-participants/missing.
- [ ] Defaults to comparing the latest two versions; `?from=&to=` overrides.
- [ ] Single-version docs render that version with a "no earlier version" note (no crash).
- [ ] Diff renders split on `lg+`, stacked below `lg`.

**Verify:** `CI=true pnpm build` → succeeds (route compiles); UI asserted in Task 5.

**Steps:**

- [ ] **Step 1: Server page**

`app/app/documents/[id]/history/page.tsx`:

```tsx
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureParticipant } from "@/lib/authz";
import { listVersions, getVersionMarkdown } from "@/lib/versions";
import { diffMarkdown } from "@/lib/diff";
import { VersionHistory } from "@/components/VersionHistory";

export default async function HistoryPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  if (!(await ensureParticipant(session.user.id, id))) notFound();

  const versions = await listVersions(id); // newest-first
  if (versions.length === 0) notFound();

  const numbers = versions.map((v) => v.versionNumber);
  const sp = await searchParams;
  const latest = numbers[0];
  const prev = numbers[1] ?? latest;
  const to = clamp(Number(sp.to) || latest, numbers);
  const from = clamp(Number(sp.from) || prev, numbers);

  let rows = null;
  if (from !== to) {
    const [oldMd, newMd] = await Promise.all([getVersionMarkdown(id, from), getVersionMarkdown(id, to)]);
    rows = diffMarkdown(oldMd ?? "", newMd ?? "");
  }
  const single = versions.length === 1 ? await getVersionMarkdown(id, latest) : null;

  return <VersionHistory documentId={id} versions={versions} from={from} to={to} rows={rows} singleMarkdown={single} />;
}

function clamp(n: number, valid: number[]): number {
  return valid.includes(n) ? n : valid[0];
}
```

- [ ] **Step 2: Presentational component**

`components/VersionHistory.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DiffRow } from "@/lib/diff";

interface VersionMeta { versionNumber: number; createdAt: string | Date; contentHash: string; createdBy: { name: string }; }

export function VersionHistory({
  documentId, versions, from, to, rows, singleMarkdown,
}: { documentId: string; versions: VersionMeta[]; from: number; to: number; rows: DiffRow[] | null; singleMarkdown: string | null; }) {
  const router = useRouter();
  const numbers = versions.map((v) => v.versionNumber);
  const nav = (f: number, t: number) => router.push(`/app/documents/${documentId}/history?from=${f}&to=${t}`);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Version history</h1>
        <Link href={`/app/documents/${documentId}`} className="text-sm text-primary hover:underline">← Back to document</Link>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="text-muted">Compare</label>
        <select data-testid="from-select" className="rounded border border-border bg-surface px-2 py-1"
          value={from} onChange={(e) => nav(Number(e.target.value), to)}>
          {numbers.map((n) => <option key={n} value={n}>v{n}</option>)}
        </select>
        <span className="text-muted">→</span>
        <select data-testid="to-select" className="rounded border border-border bg-surface px-2 py-1"
          value={to} onChange={(e) => nav(from, Number(e.target.value))}>
          {numbers.map((n) => <option key={n} value={n}>v{n}</option>)}
        </select>
      </div>

      {singleMarkdown !== null ? (
        <p className="text-sm text-muted">Only one version exists — no earlier version to compare.</p>
      ) : rows ? (
        <div data-testid="diff" className="overflow-x-auto rounded border border-border">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-1 lg:grid-cols-2 font-mono text-xs">
              <Side spans={r.oldSpans} text={r.oldText} number={r.oldNumber} side="old" kind={r.kind} />
              <Side spans={r.newSpans} text={r.newText} number={r.newNumber} side="new" kind={r.kind} />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">Select two different versions to compare.</p>
      )}
    </div>
  );
}

function Side({ spans, text, number, side, kind }: {
  spans?: { value: string; added?: boolean; removed?: boolean }[]; text?: string; number?: number;
  side: "old" | "new"; kind: DiffRow["kind"];
}) {
  const empty = (side === "old" && kind === "added") || (side === "new" && kind === "removed");
  const bg = empty ? "" : kind === "removed" && side === "old" ? "bg-[var(--state-changes-bg)]"
    : kind === "added" && side === "new" ? "bg-[var(--state-approved-bg)]"
    : kind === "changed" ? (side === "old" ? "bg-[var(--state-changes-bg)]" : "bg-[var(--state-approved-bg)]") : "";
  return (
    <div className={`flex gap-2 border-b border-border px-2 py-0.5 ${bg}`}>
      <span className="w-8 shrink-0 select-none text-right text-muted">{number ?? ""}</span>
      <pre className="whitespace-pre-wrap break-words">{spans ? spans.map((s, i) => (
        <span key={i} className={s.added ? "bg-[var(--state-approved)] text-[var(--primary-fg)]" : s.removed ? "bg-[var(--state-changes)] text-[var(--primary-fg)] line-through" : ""}>{s.value}</span>
      )) : (empty ? "" : text)}</pre>
    </div>
  );
}
```

- [ ] **Step 3: Verify build** — `CI=true pnpm build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/app/documents/[id]/history/page.tsx components/VersionHistory.tsx
git commit -m "feat(versions): read-only history route with split diff view"
```

---

### Task 5: History entry point + e2e flow

**Goal:** Add a "History" link in the document view and complete the e2e covering list + diff + selector.

**Files:**
- Modify: `components/DocumentView.tsx` (History link near Edit)
- Modify: `tests/e2e/version-history.spec.ts` (add UI flow test)

**Acceptance Criteria:**
- [ ] "History" link in the document view navigates to `/app/documents/[id]/history`.
- [ ] E2e: 3-version doc shows 3 versions; default diff is v2↔v3; switching to v1↔v3 updates the diff.

**Verify:** `CI=true pnpm test:e2e tests/e2e/version-history.spec.ts` → PASS

**Steps:**

- [ ] **Step 1: Add the History link** in `components/DocumentView.tsx`, beside the existing Edit control:

```tsx
<Link href={`/app/documents/${doc.id}/history`} data-testid="history-link" className="text-sm text-primary hover:underline">History</Link>
```

(Import `Link from "next/link"` if not already imported in the file.)

- [ ] **Step 2: Add the UI e2e flow** to `tests/e2e/version-history.spec.ts`:

```ts
test("history lists versions and diffs the selected pair", async ({ page }) => {
  // register+login (existing helper); create a doc, then edit+save twice to reach v3
  // (mirror tests/e2e/versioning.spec.ts edit/save steps)
  await page.getByTestId("history-link").click();
  await expect(page.getByTestId("from-select")).toHaveValue("2");
  await expect(page.getByTestId("to-select")).toHaveValue("3");
  await expect(page.getByTestId("diff")).toBeVisible();
  await page.getByTestId("from-select").selectOption("1");
  await expect(page).toHaveURL(/from=1&to=3/);
  await expect(page.getByTestId("diff")).toBeVisible();
});
```

- [ ] **Step 3: Run full e2e + commit**

```bash
CI=true pnpm test:e2e tests/e2e/version-history.spec.ts
git add components/DocumentView.tsx tests/e2e/version-history.spec.ts
git commit -m "feat(versions): history entry point + e2e diff flow"
```

---

## Final verification

- [ ] `CI=true pnpm lint` → clean
- [ ] `CI=true pnpm test:unit` → all PASS (diff + versions)
- [ ] `CI=true pnpm test:e2e tests/e2e/version-history.spec.ts` → PASS
- [ ] Manual: create a doc, revise twice, open History, confirm split diff on desktop and stacked on a narrow viewport; non-participant hitting `/history` gets a 404.
