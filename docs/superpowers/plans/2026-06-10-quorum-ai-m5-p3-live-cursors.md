# M5 P3 — Live Cursors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each review participant where the others are pointing — a floating marker + name label in the user's avatar color, tracking their mouse over the rendered document, live, riding the existing presence beacon and SSE (no new transport).

**Architecture:** A pointer position is encoded as `{ x, y }` normalized to the doc-body bounding box (each in `[0,1]`) and stored on the existing `PresenceEntry` alongside the P2 selection. It fans out through the unchanged `presence.updated`/`presence.sync` events. The client sends it on `mousemove` through a separate ~10Hz throttle; remote cursors render as a `pointer-events-none` React overlay child of the doc body (not direct DOM mutation, because a cursor floats on top and never wraps text). Built bottom-up: types + registry → route → pure filter → overlay component → client wiring + e2e.

**Tech Stack:** Next.js (standalone server), React 19, TypeScript, Tailwind, Vitest (node env), Playwright. Zero new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-10-quorum-ai-m5-p3-live-cursors-design.md`

**Conventions (carried from M1–M5):** pnpm v11 needs `CI=true` on script runs; free port 3000 before `pnpm test:e2e`; preserve existing `data-testid`/`aria-label` hooks; pure libs → services → routes → client; rebase onto `main` (don't merge in).

---

### Task 1: Cursor data shape + registry storage

**Goal:** Add the `PresenceCursor` type and let `heartbeat` store/clear a cursor on the presence entry, with the same full-truth semantics P2 uses for selection.

**Files:**
- Modify: `lib/events.ts` (add `PresenceCursor`, add `cursor?` to `PresenceEntry`)
- Modify: `lib/presence.ts` (re-export `PresenceCursor`; `heartbeat` 4th arg)
- Test: `tests/unit/presence.test.ts` (add cursor cases)

**Acceptance Criteria:**
- [ ] `PresenceCursor { x: number; y: number }` exported from `lib/events.ts`; `PresenceEntry.cursor?: PresenceCursor` added.
- [ ] `heartbeat(documentId, user, selection?, cursor?)` stores `cursor` when an object is given and omits it when `null`/`undefined`.
- [ ] A cursor and a selection coexist on one entry.
- [ ] Existing presence-registry tests still pass.

**Verify:** `CI=true pnpm test:unit tests/unit/presence.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Add the failing tests** to `tests/unit/presence.test.ts` (append inside the `describe("presence registry", …)` block, after the existing selection tests):

```ts
  it("heartbeat stores the cursor on the entry and publishes it", () => {
    const { events, stop } = capture("p-doc-8");
    heartbeat("p-doc-8", { userId: "u1", name: "Ada" }, null, { x: 0.25, y: 0.5 });
    expect(roster("p-doc-8")[0].cursor).toEqual({ x: 0.25, y: 0.5 });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "presence.updated",
        entry: expect.objectContaining({ cursor: { x: 0.25, y: 0.5 } }),
      })
    );
    stop();
  });

  it("heartbeat without a cursor clears a previously stored one", () => {
    heartbeat("p-doc-9", { userId: "u1", name: "Ada" }, null, { x: 0.1, y: 0.2 });
    heartbeat("p-doc-9", { userId: "u1", name: "Ada" }, null, null);
    expect(roster("p-doc-9")[0].cursor).toBeUndefined();
  });

  it("a cursor and a selection coexist on one entry", () => {
    heartbeat(
      "p-doc-10",
      { userId: "u1", name: "Ada" },
      { start: 1, end: 5, versionNumber: 1 },
      { x: 0.3, y: 0.7 },
    );
    const entry = roster("p-doc-10")[0];
    expect(entry.selection).toEqual({ start: 1, end: 5, versionNumber: 1 });
    expect(entry.cursor).toEqual({ x: 0.3, y: 0.7 });
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `CI=true pnpm test:unit tests/unit/presence.test.ts`
Expected: FAIL — `heartbeat` accepts only 3 args; `entry.cursor` is undefined / a type error.

- [ ] **Step 3: Extend `lib/events.ts`** — add the interface and the field:

```ts
export interface PresenceCursor {
  x: number; // 0..1 fraction of the doc-body box width
  y: number; // 0..1 fraction of the doc-body box height
}

export interface PresenceEntry {
  userId: string;
  name: string;
  lastSeen: number; // epoch ms
  selection?: PresenceSelection; // absent when nothing selected
  cursor?: PresenceCursor; // absent when the pointer is outside the doc body
}
```

- [ ] **Step 4: Extend `lib/presence.ts`** — re-export the type and add the 4th arg. Change the import + re-export lines:

```ts
import { publish, type PresenceEntry, type PresenceSelection, type PresenceCursor } from "@/lib/events";

export type { PresenceEntry, PresenceSelection, PresenceCursor };
```

Replace the `heartbeat` signature/body so it also stores the cursor (keep the existing JSDoc, extend it to mention the cursor):

```ts
export function heartbeat(
  documentId: string,
  user: { userId: string; name: string },
  selection?: PresenceSelection | null,
  cursor?: PresenceCursor | null,
): void {
  let docMap = registry.get(documentId);
  if (!docMap) {
    docMap = new Map();
    registry.set(documentId, docMap);
  }
  const entry: PresenceEntry = { userId: user.userId, name: user.name, lastSeen: Date.now() };
  if (selection) entry.selection = selection;
  if (cursor) entry.cursor = cursor;
  docMap.set(user.userId, entry);
  publish(documentId, { type: "presence.updated", entry });
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `CI=true pnpm test:unit tests/unit/presence.test.ts`
Expected: PASS (including the pre-existing selection/eviction tests).

- [ ] **Step 6: Commit**

```bash
rtk git add lib/events.ts lib/presence.ts tests/unit/presence.test.ts
rtk git commit -m "feat(m5-p3): presence entry carries a normalized cursor position"
```

---

### Task 2: Beacon route cursor validation

**Goal:** Parse and validate a `cursor` field on the presence beacon and pass it through to `heartbeat`, rejecting malformed values with 400.

**Files:**
- Modify: `app/api/documents/[id]/presence/route.ts` (`parseCursor`, pass 4th arg)
- Test: `tests/unit/presence.route.test.ts` (add cursor matrix; update existing `toHaveBeenCalledWith` for the new 4th arg)

**Acceptance Criteria:**
- [ ] A valid `cursor: { x, y }` (both finite, in `[0,1]`) → 204 and passed to `heartbeat` as the 4th arg.
- [ ] `cursor: null` / absent → `heartbeat` called with `null` cursor.
- [ ] `x`/`y` out of `[0,1]`, non-finite (NaN/Infinity), non-number, missing, or a non-object cursor → 400, `heartbeat` not called.
- [ ] All pre-existing route tests pass (updated for the 4th arg).

**Verify:** `CI=true pnpm test:unit tests/unit/presence.route.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Update existing assertions for the new 4th arg.** In `tests/unit/presence.route.test.ts`, every `expect(presence.heartbeat).toHaveBeenCalledWith(...)` gains a trailing `null` cursor arg. Apply these exact replacements:

  - "heartbeats and returns 204 for a participant":
    `expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "Ada" }, null, null);`
  - "falls back to email then 'Someone' for a blank name":
    `expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "a@b.co" }, null, null);`
  - "passes a valid selection through to heartbeat":
    ```ts
    expect(presence.heartbeat).toHaveBeenCalledWith(
      "doc1",
      { userId: "u1", name: "Ada" },
      { start: 2, end: 7, versionNumber: 3 },
      null,
    );
    ```
  - "treats selection:null as clearing":
    `expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "Ada" }, null, null);`
  - "returns 204 and heartbeats with null when the body is not parseable JSON":
    `expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "Ada" }, null, null);`

- [ ] **Step 2: Add the cursor test cases** to `tests/unit/presence.route.test.ts` (append inside the `describe`):

```ts
  it("passes a valid cursor through to heartbeat", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req({ cursor: { x: 0.25, y: 0.75 } }), ctx);
    expect(res.status).toBe(204);
    expect(presence.heartbeat).toHaveBeenCalledWith(
      "doc1",
      { userId: "u1", name: "Ada" },
      null,
      { x: 0.25, y: 0.75 },
    );
  });

  it("passes selection and cursor together", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(
      req({ selection: { start: 2, end: 7, versionNumber: 3 }, cursor: { x: 0, y: 1 } }),
      ctx,
    );
    expect(res.status).toBe(204);
    expect(presence.heartbeat).toHaveBeenCalledWith(
      "doc1",
      { userId: "u1", name: "Ada" },
      { start: 2, end: 7, versionNumber: 3 },
      { x: 0, y: 1 },
    );
  });

  it("treats cursor:null as clearing", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req({ cursor: null }), ctx);
    expect(res.status).toBe(204);
    expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "Ada" }, null, null);
  });

  it.each([
    { x: -0.01, y: 0.5 }, // x below range
    { x: 1.01, y: 0.5 }, // x above range
    { x: 0.5, y: -1 }, // y below range
    { x: 0.5, y: 2 }, // y above range
    { x: "0.5", y: 0.5 }, // non-number
    { x: 0.5 }, // missing y
    { x: Number.NaN, y: 0.5 }, // non-finite
    "nonsense", // wrong type
  ])("rejects malformed cursor %j with 400", async (cursor) => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req({ cursor }), ctx);
    expect(res.status).toBe(400);
    expect(presence.heartbeat).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `CI=true pnpm test:unit tests/unit/presence.route.test.ts`
Expected: FAIL — route passes only 3 args (updated assertions fail) and does not validate `cursor` (malformed cases return 204).

- [ ] **Step 4: Implement in `app/api/documents/[id]/presence/route.ts`.** Add `PresenceCursor` to the import, add `parseCursor`, and pass the cursor through:

```ts
import { heartbeat, leave, type PresenceSelection, type PresenceCursor } from "@/lib/presence";
```

Add this helper next to `parseSelection`:

```ts
/** null = no cursor; "invalid" = malformed payload (reject with 400). */
function parseCursor(raw: unknown): PresenceCursor | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "invalid";
  const { x, y } = raw as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number") return "invalid";
  if (!Number.isFinite(x) || !Number.isFinite(y)) return "invalid";
  if (x < 0 || x > 1 || y < 0 || y > 1) return "invalid";
  return { x, y } as PresenceCursor;
}
```

In `POST`, after the selection block, before building `name`:

```ts
  const selection = parseSelection(body?.selection);
  if (selection === "invalid") return NextResponse.json({ error: "invalid selection" }, { status: 400 });
  const cursor = parseCursor(body?.cursor);
  if (cursor === "invalid") return NextResponse.json({ error: "invalid cursor" }, { status: 400 });
  const name = (user.name && user.name.trim()) || user.email || "Someone";
  heartbeat(id, { userId: user.id, name }, selection, cursor);
  return new Response(null, { status: 204 });
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `CI=true pnpm test:unit tests/unit/presence.route.test.ts`
Expected: PASS (cursor matrix + all updated selection/auth tests).

- [ ] **Step 6: Commit**

```bash
rtk git add app/api/documents/[id]/presence/route.ts tests/unit/presence.route.test.ts
rtk git commit -m "feat(m5-p3): presence beacon validates and forwards cursor position"
```

---

### Task 3: `remoteCursors` filter

**Goal:** A pure helper that selects other users' cursors from the roster for rendering.

**Files:**
- Modify: `lib/presence-client.ts` (`RemoteCursor`, `remoteCursors`)
- Test: `tests/unit/presence-client.test.ts` (add `remoteCursors` describe block)

**Acceptance Criteria:**
- [ ] `remoteCursors(roster, selfId)` returns `{ userId, name, x, y }[]`, dropping self and entries without a cursor.
- [ ] No version filtering (cursors are not version-bound).

**Verify:** `CI=true pnpm test:unit tests/unit/presence-client.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Add the failing tests** to `tests/unit/presence-client.test.ts` (append a new `describe`):

```ts
import { applyPresenceEvent, remoteCursors, remoteSelections } from "@/lib/presence-client";
// ^ update the existing import line to include remoteCursors

describe("remoteCursors", () => {
  const roster: PresenceEntry[] = [
    { userId: "self", name: "Me", lastSeen: 1, cursor: { x: 0.1, y: 0.1 } },
    { userId: "u2", name: "Grace", lastSeen: 1, cursor: { x: 0.4, y: 0.6 } },
    { userId: "u3", name: "Linus", lastSeen: 1 }, // no cursor
  ];

  it("keeps only other users' cursors", () => {
    expect(remoteCursors(roster, "self")).toEqual([
      { userId: "u2", name: "Grace", x: 0.4, y: 0.6 },
    ]);
  });

  it("returns an empty array when nobody else has a cursor", () => {
    expect(remoteCursors(roster.slice(0, 1), "self")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `CI=true pnpm test:unit tests/unit/presence-client.test.ts`
Expected: FAIL — `remoteCursors` is not exported.

- [ ] **Step 3: Implement in `lib/presence-client.ts`** (add below `RemoteSelection`/`remoteSelections`):

```ts
export interface RemoteCursor {
  userId: string;
  name: string;
  x: number;
  y: number;
}

/** Other users' live cursor positions (self and cursor-less entries dropped). */
export function remoteCursors(roster: PresenceEntry[], selfId: string): RemoteCursor[] {
  const out: RemoteCursor[] = [];
  for (const e of roster) {
    if (e.userId === selfId || !e.cursor) continue;
    out.push({ userId: e.userId, name: e.name, x: e.cursor.x, y: e.cursor.y });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `CI=true pnpm test:unit tests/unit/presence-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add lib/presence-client.ts tests/unit/presence-client.test.ts
rtk git commit -m "feat(m5-p3): remoteCursors selects other participants' cursors"
```

---

### Task 4: `PresenceCursors` overlay component

**Goal:** A presentational overlay that renders each remote cursor as a colored marker + name pill positioned at `left:x%, top:y%`.

**Files:**
- Create: `components/PresenceCursors.tsx`

**Acceptance Criteria:**
- [ ] Renders `null` when there are no cursors.
- [ ] For each cursor, renders an element with `data-presence-cursor-user-id` and `data-user-name`, positioned via `left`/`top` percent style, colored via `colorFor(userId)`.
- [ ] The overlay is `pointer-events-none absolute inset-0` so it never intercepts clicks or affects layout.
- [ ] `pnpm lint` and the type-check (via `next build`/`tsc` in CI) pass; exercised end-to-end in Task 5.

**Verify:** `CI=true pnpm lint` → no errors for the new file (full behavior verified by the Task 5 e2e).

**Steps:**

- [ ] **Step 1: Create `components/PresenceCursors.tsx`:**

```tsx
"use client";
import { colorFor } from "@/lib/presence-roster";
import type { RemoteCursor } from "@/lib/presence-client";

/**
 * Floating overlay of other participants' live cursors. A pointer-events-none
 * child of the (relative) doc-body container, so percent positions map to that
 * box and clicks/selection pass straight through to the document underneath.
 */
export default function PresenceCursors({ cursors }: { cursors: RemoteCursor[] }) {
  if (cursors.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {cursors.map((c) => (
        <span
          key={c.userId}
          data-presence-cursor-user-id={c.userId}
          data-user-name={c.name}
          className="absolute flex items-center gap-1"
          style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
        >
          <span className={`${colorFor(c.userId)} block h-3 w-3 rounded-full ring-2 ring-surface`} />
          <span
            className={`${colorFor(c.userId)} rounded px-1.5 py-0.5 text-xs font-medium text-white whitespace-nowrap`}
          >
            {c.name}
          </span>
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Lint the new file**

Run: `CI=true pnpm lint`
Expected: PASS (no errors/warnings introduced).

- [ ] **Step 3: Commit**

```bash
rtk git add components/PresenceCursors.tsx
rtk git commit -m "feat(m5-p3): PresenceCursors overlay component"
```

---

### Task 5: Wire cursor send path + overlay in DocumentView, with e2e

**Goal:** Track the local pointer over the doc body (review mode), send it on a ~10Hz throttle through the existing beacon, and render remote cursors via the overlay; verify end-to-end with two browser contexts.

**Files:**
- Modify: `components/DocumentView.tsx` (imports; `cursorRef`; cursor throttle + `queueCursorSend`; `sendPresence` body; `mousemove`/`mouseleave` effect; `relative` doc body; render `<PresenceCursors>`)
- Create: `tests/e2e/cursors.spec.ts`

**Acceptance Criteria:**
- [ ] `sendPresence` posts `{ selection: selectionRef.current, cursor: cursorRef.current }`.
- [ ] A `mousemove` over the doc body updates `cursorRef` to normalized `[0,1]` coords and sends through `NEXT_PUBLIC_PRESENCE_CURSOR_THROTTLE_MS` (default 100), separate from the selection throttle.
- [ ] `mouseleave` clears the cursor and sends once on the transition; switching to edit mode tears the listeners down and clears the cursor.
- [ ] The doc body is `position: relative` and renders `<PresenceCursors cursors={remoteCursors(roster, currentUserId)} />` in review mode.
- [ ] e2e: B moving the mouse over the doc → A sees `[data-presence-cursor-user-id]` with `data-user-name` "Grace"; B leaving → it disappears; cursor + selection coexist; tab stays at 2 EventSources.

**Verify:** `CI=true pnpm test:e2e cursors` → all pass (free port 3000 first). Then full gates: `CI=true pnpm test:unit`, `CI=true pnpm test:e2e`, `CI=true pnpm lint`.

**Steps:**

- [ ] **Step 1: Write the failing e2e** — create `tests/e2e/cursors.spec.ts`:

```ts
import { test, expect, type Page, type BrowserContext } from "@playwright/test";

async function register(page: Page, name: string): Promise<void> {
  const email = `${name.toLowerCase()}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill(name);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);
}

async function createDoc(page: Page, title: string, markdown: string): Promise<string> {
  await page.goto("/app");
  await page.getByLabel("title").fill(title);
  await page.getByLabel("markdown").fill(markdown);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/app\/documents\/[^/]+$/);
  return page.url();
}

async function countEventSources(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as { __esCount: number; EventSource: typeof EventSource };
    w.__esCount = 0;
    const Native = w.EventSource;
    class Counting extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        w.__esCount += 1;
      }
    }
    w.EventSource = Counting as unknown as typeof EventSource;
  });
}

async function moveOverDocBody(page: Page): Promise<void> {
  const box = await page.getByTestId("doc-body").boundingBox();
  if (!box) throw new Error("doc-body has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
}

test("remote cursor appears on move and clears when the pointer leaves the doc", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  await countEventSources(ctxA);
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await register(pageA, "Ada");
  const docUrl = await createDoc(pageA, "Cursor demo", "# Hello\n\nReview me together.\n\nAnother paragraph here.");

  await register(pageB, "Grace");
  await pageB.goto(docUrl);
  await expect(pageB.getByTestId("doc-body")).toBeVisible();
  await expect(pageA.getByTestId("presence-roster")).toHaveAttribute("aria-label", /2 people viewing/);

  // B moves the mouse over the doc; A sees a cursor labelled "Grace".
  await moveOverDocBody(pageB);
  const remoteCursor = pageA.locator("[data-presence-cursor-user-id]");
  await expect(remoteCursor).toHaveCount(1);
  await expect(remoteCursor).toHaveAttribute("data-user-name", "Grace");
  // B never renders its own cursor.
  await expect(pageB.locator("[data-presence-cursor-user-id]")).toHaveCount(0);

  // B moves the pointer out of the doc body; A's cursor disappears.
  await pageB.mouse.move(2, 2, { steps: 2 });
  await expect(remoteCursor).toHaveCount(0);

  // Still exactly two EventSources in A's tab (document + notifications).
  const esCount = await pageA.evaluate(() => (window as unknown as { __esCount: number }).__esCount);
  expect(esCount).toBe(2);

  await ctxA.close();
  await ctxB.close();
});

test("a remote cursor and a remote selection coexist", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await register(pageA, "Ada");
  const docUrl = await createDoc(pageA, "Cursor+selection demo", "# Hello\n\nReview me together.\n\nAnother paragraph here.");

  await register(pageB, "Grace");
  await pageB.goto(docUrl);
  await expect(pageB.getByTestId("doc-body")).toBeVisible();
  await expect(pageA.getByTestId("presence-roster")).toHaveAttribute("aria-label", /2 people viewing/);

  // B selects text AND moves the mouse; A sees both layers from the same user.
  await pageB.getByTestId("doc-body").getByText("Review me together.").first().selectText();
  await moveOverDocBody(pageB);
  await expect(pageA.locator("mark[data-presence-user-id]")).toHaveCount(1);
  await expect(pageA.locator("[data-presence-cursor-user-id]")).toHaveCount(1);

  await ctxA.close();
  await ctxB.close();
});
```

- [ ] **Step 2: Run the e2e to confirm it fails**

Run: `CI=true pnpm test:e2e cursors`
Expected: FAIL — no `[data-presence-cursor-user-id]` element exists yet.

- [ ] **Step 3: Extend the imports in `components/DocumentView.tsx`.** Add `remoteCursors` to the presence-client import, import the component, and add `PresenceCursor` to the events type import:

```tsx
import { applyPresenceEvent, remoteCursors, remoteSelections } from "@/lib/presence-client";
import PresenceRoster from "@/components/PresenceRoster";
import PresenceCursors from "@/components/PresenceCursors";
import type { PresenceEntry, PresenceCursor, PresenceSelection } from "@/lib/events";
```

- [ ] **Step 4: Add the cursor ref and throttle.** Declare `cursorRef` immediately after the existing `selectionRef` declaration (`:92`), so it exists before `sendPresence` closes over it:

```tsx
  const selectionRef = useRef<PresenceSelection | null>(null);
  const cursorRef = useRef<PresenceCursor | null>(null);
```

Update `sendPresence` to send both refs:

```tsx
  const sendPresence = useCallback(() => {
    fetch(`/api/documents/${doc.id}/presence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selection: selectionRef.current, cursor: cursorRef.current }),
      keepalive: true,
    }).catch(() => {});
  }, [doc.id]);
```

Add a separate cursor throttle mirroring `queueSelectionSend` (place after `queueSelectionSend`):

```tsx
  // Cursor moves are continuous and higher-rate than selections, so they ride
  // their own throttle (default ~10Hz) and never delay a selection send.
  const cursorThrottleRef = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null }>({ last: 0, timer: null });
  const queueCursorSend = useCallback(() => {
    const throttleMs = Number(process.env.NEXT_PUBLIC_PRESENCE_CURSOR_THROTTLE_MS ?? 100);
    const t = cursorThrottleRef.current;
    const elapsed = Date.now() - t.last;
    if (elapsed >= throttleMs) {
      t.last = Date.now();
      sendPresence();
    } else if (!t.timer) {
      t.timer = setTimeout(() => {
        t.timer = null;
        t.last = Date.now();
        sendPresence();
      }, throttleMs - elapsed);
    }
  }, [sendPresence]);
```

- [ ] **Step 5: Add the pointer-tracking effect.** Place it right after the presence-selection `useEffect` (the one ending at `[roster, versionNumber, markdown, mode, currentUserId]`):

```tsx
  // Track the local pointer over the doc body and broadcast it (review mode
  // only). Listeners live on the container so we never broadcast pointer
  // positions over the sidebar/chrome. Coordinates are normalized to the
  // container box; the receiver renders them as left/top percent.
  useEffect(() => {
    if (mode !== "review") return;
    const container = containerRef.current;
    if (!container) return;
    const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
    const onMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      cursorRef.current = {
        x: clamp01((e.clientX - rect.left) / rect.width),
        y: clamp01((e.clientY - rect.top) / rect.height),
      };
      queueCursorSend();
    };
    const onLeave = () => {
      if (cursorRef.current !== null) {
        cursorRef.current = null;
        queueCursorSend();
      }
    };
    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseleave", onLeave);
    return () => {
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
      const t = cursorThrottleRef.current;
      if (t.timer) {
        clearTimeout(t.timer);
        t.timer = null;
      }
      // Leaving review mode (or unmount): drop our cursor for everyone else.
      if (cursorRef.current !== null) {
        cursorRef.current = null;
        sendPresence();
      }
    };
  }, [mode, queueCursorSend, sendPresence]);
```

- [ ] **Step 6: Make the doc body relative and render the overlay.** In the review-mode branch, add `relative` to the container `className` and render the overlay as a child after `RenderedMarkdown`:

```tsx
          <div
            ref={containerRef}
            data-testid="doc-body"
            onClick={onContainerClick}
            className="prose prose-violet max-w-none rounded-[var(--radius-app)] border border-border bg-surface p-6 relative"
          >
            <RenderedMarkdown key={versionNumber} markdown={markdown} />
            <PresenceCursors cursors={remoteCursors(roster, currentUserId)} />
          </div>
```

- [ ] **Step 7: Run the e2e to confirm it passes** (free port 3000 first)

Run: `CI=true pnpm test:e2e cursors`
Expected: PASS — both cursor tests green.

- [ ] **Step 8: Run the full gates**

Run: `CI=true pnpm test:unit` → all pass.
Run: `CI=true pnpm test:e2e` → all pass (including the existing `presence.spec.ts`/`selections.spec.ts`).
Run: `CI=true pnpm lint` → clean.

- [ ] **Step 9: Commit**

```bash
rtk git add components/DocumentView.tsx components/PresenceCursors.tsx tests/e2e/cursors.spec.ts
rtk git commit -m "feat(m5-p3): broadcast and render live participant cursors"
```

---

## Done criteria

- [ ] `PresenceCursor` type + registry storage (Task 1).
- [ ] Beacon validates + forwards the cursor (Task 2).
- [ ] `remoteCursors` filter (Task 3).
- [ ] `PresenceCursors` overlay (Task 4).
- [ ] Client send path + overlay wiring + e2e (Task 5).
- [ ] All three gates green: `CI=true pnpm test:unit`, `CI=true pnpm test:e2e`, `CI=true pnpm lint`.
- [ ] Open a PR (don't merge `main` in; rebase if needed).
