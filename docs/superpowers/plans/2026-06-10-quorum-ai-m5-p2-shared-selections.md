# M5 P2: Shared Selections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each participant viewing a document sees what text the others have selected, live — a translucent band in the other user's avatar color with their name on hover.

**Architecture:** Selections piggyback on the P1 presence beacon (`POST /api/documents/[id]/presence`) and fan out through the existing SSE presence events — no new transport, no new EventSource, no new DocEvent types. The registry entry gains an optional `selection`; the client sends its selection through a leading+trailing throttle and renders remote selections as a separate direct-DOM mark layer (`mark[data-presence-user-id]`) that never touches the annotation-highlight layer.

**Tech Stack:** Next.js 16 (standalone), React 19, in-memory presence registry (`lib/presence.ts`), SSE via `lib/events.ts`, Vitest (node env, pure helpers only), Playwright (two-context e2e).

**Spec:** `docs/superpowers/specs/2026-06-10-quorum-ai-m5-p2-shared-selections-design.md`

**Conventions:** pure libs → routes → client; TDD within each task; one commit per task; never add a third `EventSource`; preserve existing `data-testid`/`aria-label` hooks. Worktree note: this repo's pnpm may need `CI=true` on script runs.

---

### Task 1: Selection types + registry storage

**Goal:** `PresenceEntry` can carry an optional `selection` and `heartbeat()` stores/clears it; the existing presence events fan it out unchanged.

**Files:**
- Modify: `lib/events.ts:13-17` (add `PresenceSelection`, extend `PresenceEntry`)
- Modify: `lib/presence.ts:16-25` (heartbeat third argument)
- Test: `tests/unit/presence.test.ts` (append two tests)

**Acceptance Criteria:**
- [ ] `heartbeat(docId, user, { start, end, versionNumber })` stores the selection on the entry and the published `presence.updated` carries it
- [ ] `heartbeat(docId, user, null)` (or omitted) clears a previously stored selection
- [ ] All existing presence unit tests still pass unchanged

**Verify:** `pnpm test:unit -- tests/unit/presence.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Write the failing tests** — append to `tests/unit/presence.test.ts` inside the existing `describe("presence registry", ...)`:

```ts
  it("heartbeat stores the selection on the entry and publishes it", () => {
    const { events, stop } = capture("p-doc-6");
    heartbeat("p-doc-6", { userId: "u1", name: "Ada" }, { start: 4, end: 9, versionNumber: 1 });
    expect(roster("p-doc-6")[0].selection).toEqual({ start: 4, end: 9, versionNumber: 1 });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "presence.updated",
        entry: expect.objectContaining({ selection: { start: 4, end: 9, versionNumber: 1 } }),
      })
    );
    stop();
  });

  it("heartbeat without a selection clears a previously stored one", () => {
    heartbeat("p-doc-7", { userId: "u1", name: "Ada" }, { start: 0, end: 3, versionNumber: 2 });
    heartbeat("p-doc-7", { userId: "u1", name: "Ada" }, null);
    expect(roster("p-doc-7")[0].selection).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- tests/unit/presence.test.ts`
Expected: FAIL — TS error (heartbeat takes 2 args) / `selection` undefined.

- [ ] **Step 3: Implement.** In `lib/events.ts`, replace the `PresenceEntry` interface (lines 13-17) with:

```ts
export interface PresenceSelection {
  start: number; // offset into the rendered container's textContent
  end: number; // exclusive; start < end
  versionNumber: number; // document version the offsets were measured against
}

export interface PresenceEntry {
  userId: string;
  name: string;
  lastSeen: number; // epoch ms
  selection?: PresenceSelection; // absent when nothing selected
}
```

In `lib/presence.ts`, update the import/re-export (lines 1-3) and `heartbeat` (lines 15-25):

```ts
import { publish, type PresenceEntry, type PresenceSelection } from "@/lib/events";

export type { PresenceEntry, PresenceSelection };
```

```ts
/** Upsert the user's presence in a document, bump lastSeen, and broadcast.
 *  Every heartbeat states the full selection truth: an object sets it,
 *  null/undefined clears it (the client owns its selection state). */
export function heartbeat(
  documentId: string,
  user: { userId: string; name: string },
  selection?: PresenceSelection | null,
): void {
  let docMap = registry.get(documentId);
  if (!docMap) {
    docMap = new Map();
    registry.set(documentId, docMap);
  }
  const entry: PresenceEntry = { userId: user.userId, name: user.name, lastSeen: Date.now() };
  if (selection) entry.selection = selection;
  docMap.set(user.userId, entry);
  publish(documentId, { type: "presence.updated", entry });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- tests/unit/presence.test.ts`
Expected: PASS (all, including the 5 pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add lib/events.ts lib/presence.ts tests/unit/presence.test.ts
git commit -m "feat(m5-p2): presence entries carry an optional text selection"
```

---

### Task 2: Beacon route parses + validates the selection

**Goal:** The presence POST accepts `{ selection: { start, end, versionNumber } | null }`, rejects malformed payloads with 400, and passes valid ones to `heartbeat()`.

**Files:**
- Modify: `app/api/documents/[id]/presence/route.ts`
- Test: `tests/unit/presence.route.test.ts` (two existing assertions updated + new tests)

**Acceptance Criteria:**
- [ ] Valid selection → 204 and `heartbeat("doc1", {…}, { start, end, versionNumber })`
- [ ] `selection: null` or absent → 204 and `heartbeat(…, null)`
- [ ] Malformed selection (empty range, negative start, version < 1, non-integers, wrong type) → 400, `heartbeat` NOT called
- [ ] `leaving: true`, 401, 404 behaviors unchanged

**Verify:** `pnpm test:unit -- tests/unit/presence.route.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Write the failing tests.** In `tests/unit/presence.route.test.ts`, update the two existing `heartbeat` assertions to expect the new third argument:

```ts
    expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "Ada" }, null);
```

```ts
    expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "a@b.co" }, null);
```

Append inside the describe block:

```ts
  it("passes a valid selection through to heartbeat", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req({ selection: { start: 2, end: 7, versionNumber: 3 } }), ctx);
    expect(res.status).toBe(204);
    expect(presence.heartbeat).toHaveBeenCalledWith(
      "doc1",
      { userId: "u1", name: "Ada" },
      { start: 2, end: 7, versionNumber: 3 },
    );
  });

  it("treats selection:null as clearing", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req({ selection: null }), ctx);
    expect(res.status).toBe(204);
    expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "Ada" }, null);
  });

  it.each([
    { start: 5, end: 5, versionNumber: 1 }, // empty range
    { start: -1, end: 4, versionNumber: 1 }, // negative start
    { start: 0, end: 4, versionNumber: 0 }, // version < 1
    { start: 0.5, end: 4, versionNumber: 1 }, // non-integer
    { start: 0, end: 4 }, // missing versionNumber
    "nonsense", // wrong type
  ])("rejects malformed selection %j with 400", async (selection) => {
    vi.mocked(api.requireUser).mockResolvedValueOnce({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValueOnce(true);
    const res = await POST(req({ selection }), ctx);
    expect(res.status).toBe(400);
    expect(presence.heartbeat).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- tests/unit/presence.route.test.ts`
Expected: FAIL — heartbeat called with 2 args; no 400 path.

- [ ] **Step 3: Implement.** Replace `app/api/documents/[id]/presence/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { isParticipant } from "@/lib/authz";
import { heartbeat, leave, type PresenceSelection } from "@/lib/presence";

/** null = no selection; "invalid" = malformed payload (reject with 400). */
function parseSelection(raw: unknown): PresenceSelection | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "invalid";
  const { start, end, versionNumber } = raw as Record<string, unknown>;
  if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(versionNumber)) return "invalid";
  if ((start as number) < 0 || (start as number) >= (end as number) || (versionNumber as number) < 1) return "invalid";
  return { start, end, versionNumber } as PresenceSelection;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isParticipant(user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (body?.leaving === true) {
    leave(id, user.id);
    return new Response(null, { status: 204 });
  }
  const selection = parseSelection(body?.selection);
  if (selection === "invalid") return NextResponse.json({ error: "invalid selection" }, { status: 400 });
  const name = (user.name && user.name.trim()) || user.email || "Someone";
  heartbeat(id, { userId: user.id, name }, selection);
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- tests/unit/presence.route.test.ts`
Expected: PASS (existing 5 + new 8).

- [ ] **Step 5: Commit**

```bash
git add app/api/documents/[id]/presence/route.ts tests/unit/presence.route.test.ts
git commit -m "feat(m5-p2): presence beacon accepts and validates a selection range"
```

---

### Task 3: Pure client helpers — remote-selection filter + selection palette

**Goal:** A node-testable filter that turns the roster into renderable remote selections (dropping self, empty, and version-mismatched entries), plus a translucent per-user color palette aligned with the avatar colors.

**Files:**
- Modify: `lib/presence-client.ts` (add `RemoteSelection`, `remoteSelections`)
- Modify: `lib/presence-roster.ts` (extract `hashOf`, add `SELECTION_COLORS`, `selectionColorFor`)
- Test: `tests/unit/presence-client.test.ts`, `tests/unit/presence-roster.test.ts` (append)

**Acceptance Criteria:**
- [ ] `remoteSelections` drops self, entries without `selection`, and selections whose `versionNumber` differs from the local one
- [ ] `selectionColorFor(userId)` is deterministic and uses the same palette index as `colorFor(userId)`
- [ ] Existing reducer/roster tests pass unchanged

**Verify:** `pnpm test:unit -- tests/unit/presence-client.test.ts tests/unit/presence-roster.test.ts` → all pass

**Steps:**

- [ ] **Step 1: Write the failing tests.** Append to `tests/unit/presence-client.test.ts`:

```ts
import { remoteSelections } from "@/lib/presence-client";

describe("remoteSelections", () => {
  const versionNumber = 3;
  const roster = [
    { userId: "self", name: "Me", lastSeen: 1, selection: { start: 0, end: 4, versionNumber } },
    { userId: "u2", name: "Grace", lastSeen: 1, selection: { start: 5, end: 9, versionNumber } },
    { userId: "u3", name: "Linus", lastSeen: 1 }, // no selection
    { userId: "u4", name: "Old", lastSeen: 1, selection: { start: 1, end: 2, versionNumber: 2 } }, // stale version
  ];

  it("keeps only other users' selections matching the local version", () => {
    expect(remoteSelections(roster, "self", versionNumber)).toEqual([
      { userId: "u2", name: "Grace", start: 5, end: 9 },
    ]);
  });

  it("returns an empty array when nobody else has a current selection", () => {
    expect(remoteSelections(roster.slice(0, 1), "self", versionNumber)).toEqual([]);
  });
});
```

Append to `tests/unit/presence-roster.test.ts`:

```ts
import { AVATAR_COLORS, SELECTION_COLORS, colorFor, selectionColorFor } from "@/lib/presence-roster";

describe("selectionColorFor", () => {
  it("is deterministic and drawn from SELECTION_COLORS", () => {
    const c = selectionColorFor("user-abc");
    expect(selectionColorFor("user-abc")).toBe(c);
    expect(SELECTION_COLORS).toContain(c);
  });

  it("uses the same palette index as the avatar color", () => {
    for (const id of ["u1", "user-abc", "cmh000xyz"]) {
      expect(SELECTION_COLORS.indexOf(selectionColorFor(id) as (typeof SELECTION_COLORS)[number]))
        .toBe(AVATAR_COLORS.indexOf(colorFor(id) as (typeof AVATAR_COLORS)[number]));
    }
  });
});
```

(Adjust the import lines to merge with each file's existing imports.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- tests/unit/presence-client.test.ts tests/unit/presence-roster.test.ts`
Expected: FAIL — `remoteSelections` / `selectionColorFor` not exported.

- [ ] **Step 3: Implement.** Append to `lib/presence-client.ts`:

```ts
export interface RemoteSelection {
  userId: string;
  name: string;
  start: number;
  end: number;
}

/** Other users' selections that are valid for the local document version. */
export function remoteSelections(
  roster: PresenceEntry[],
  selfId: string,
  versionNumber: number,
): RemoteSelection[] {
  const out: RemoteSelection[] = [];
  for (const e of roster) {
    if (e.userId === selfId || !e.selection) continue;
    if (e.selection.versionNumber !== versionNumber) continue;
    out.push({ userId: e.userId, name: e.name, start: e.selection.start, end: e.selection.end });
  }
  return out;
}
```

In `lib/presence-roster.ts`, extract the hash from `colorFor` and add the palette (translucent counterparts of `AVATAR_COLORS`, same order):

```ts
export const SELECTION_COLORS = [
  "bg-rose-500/25", "bg-orange-500/25", "bg-amber-500/25", "bg-emerald-500/25",
  "bg-teal-500/25", "bg-sky-500/25", "bg-indigo-500/25", "bg-violet-500/25", "bg-fuchsia-500/25",
] as const;

function hashOf(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return hash;
}

export function colorFor(userId: string): string {
  return AVATAR_COLORS[hashOf(userId) % AVATAR_COLORS.length];
}

/** Translucent selection tint matching the user's avatar color. */
export function selectionColorFor(userId: string): string {
  return SELECTION_COLORS[hashOf(userId) % SELECTION_COLORS.length];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- tests/unit/presence-client.test.ts tests/unit/presence-roster.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add lib/presence-client.ts lib/presence-roster.ts tests/unit/presence-client.test.ts tests/unit/presence-roster.test.ts
git commit -m "feat(m5-p2): remote-selection filter and per-user selection palette"
```

---

### Task 4: Presence mark layer in lib/highlight.ts

**Goal:** `applyPresenceSelections` / `clearPresenceSelections` render remote selections as `mark[data-presence-user-id]`, sharing a parameterized `wrapRange` with the annotation layer and never touching `mark[data-annotation-id]`.

**Files:**
- Modify: `lib/highlight.ts:50-97`

**Acceptance Criteria:**
- [ ] `wrapRange` takes a mark factory; `applyHighlights` produces byte-identical mark markup to today (class, `data-annotation-id`, `data-status`, MOVED title)
- [ ] `applyPresenceSelections` clears + rewraps only `mark[data-presence-user-id]`, with `data-user-name`, `title` = name, class from `selectionColorFor`
- [ ] No unit-test regressions (`highlight.buildRanges.test.ts` untouched and green); DOM behavior is covered by Task 7's e2e

**Verify:** `pnpm test:unit && pnpm lint` → green (DOM functions have no node-env unit tests, same as the existing annotation layer)

**Steps:**

- [ ] **Step 1: Implement.** In `lib/highlight.ts`, add imports at the top:

```ts
import type { RemoteSelection } from "@/lib/presence-client";
import { selectionColorFor } from "@/lib/presence-roster";
```

Replace `applyHighlights`, `clearHighlights`, and `wrapRange` (lines 50-97) with:

```ts
export function applyHighlights(container: HTMLElement, ranges: HighlightRange[]): void {
  clearHighlights(container);
  for (const range of ranges) {
    wrapRange(container, range, () => {
      const mark = document.createElement("mark");
      const moved = range.status === "MOVED";
      mark.className = `${moved ? "bg-orange-200" : "bg-yellow-200"} cursor-pointer`;
      mark.setAttribute("data-annotation-id", range.id);
      mark.setAttribute("data-status", range.status ?? "ACTIVE");
      if (moved) mark.title = "This comment moved when the document was edited.";
      return mark;
    });
  }
}

export function clearHighlights(container: HTMLElement): void {
  unwrapMarks(container, "mark[data-annotation-id]");
}

/**
 * Render other users' live selections as a separate mark layer. Operates
 * exclusively on mark[data-presence-user-id]; annotation marks are never
 * touched, so high-frequency presence churn can't thrash that layer.
 */
export function applyPresenceSelections(container: HTMLElement, selections: RemoteSelection[]): void {
  clearPresenceSelections(container);
  for (const sel of selections) {
    wrapRange(container, sel, () => {
      const mark = document.createElement("mark");
      mark.className = `${selectionColorFor(sel.userId)} rounded-sm`;
      mark.setAttribute("data-presence-user-id", sel.userId);
      mark.setAttribute("data-user-name", sel.name);
      mark.title = sel.name;
      return mark;
    });
  }
}

export function clearPresenceSelections(container: HTMLElement): void {
  unwrapMarks(container, "mark[data-presence-user-id]");
}

function unwrapMarks(container: HTMLElement, selector: string): void {
  const marks = container.querySelectorAll(selector);
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

function wrapRange(
  container: HTMLElement,
  range: { start: number; end: number },
  makeMark: () => HTMLElement,
): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.data.length;
    // Only handle ranges that fall entirely within a single text node.
    if (range.start >= offset && range.end <= offset + len && range.end > range.start) {
      const localStart = range.start - offset;
      const localEnd = range.end - offset;
      const domRange = document.createRange();
      domRange.setStart(node, localStart);
      domRange.setEnd(node, localEnd);
      try {
        domRange.surroundContents(makeMark());
      } catch {
        // Crosses an element boundary — fallback: no inline mark for this range.
      }
      return;
    }
    offset += len;
    node = walker.nextNode() as Text | null;
  }
}
```

(Note: the existing per-mark attributes move into the annotation factory closure; `wrapRange` no longer reads `range.id`/`range.status`.)

- [ ] **Step 2: Verify no regressions**

Run: `pnpm test:unit && pnpm lint`
Expected: all unit tests pass (incl. `highlight.buildRanges.test.ts`), lint clean.

- [ ] **Step 3: Commit**

```bash
git add lib/highlight.ts
git commit -m "feat(m5-p2): presence-selection mark layer with shared wrapRange"
```

---

### Task 5: DocumentView sends the selection through the beacon

**Goal:** The user's current selection (or its absence) rides every presence POST; selection changes trigger a throttled immediate send.

**Files:**
- Modify: `components/DocumentView.tsx` (selectionchange handler `:102-121`, heartbeat effect `:294-317`)

**Acceptance Criteria:**
- [ ] One `sendPresence()` posts `{ selection: selectionRef.current }` for mount, 10s interval, and selection changes
- [ ] Selection changes send through a leading+trailing throttle, `NEXT_PUBLIC_PRESENCE_SELECTION_THROTTLE_MS` (default 250ms); trailing edge guarantees the final state is sent
- [ ] Collapsed/outside-container selection sets the ref to `null` and sends (clears) — without disturbing the `PendingSelection` comment-composer behavior
- [ ] `pagehide`/unmount leave beacon unchanged; throttle timer cleaned up on unmount

**Verify:** `pnpm lint && pnpm test:unit` green (behavioral coverage lands in Task 7's e2e)

**Steps:**

- [ ] **Step 1: Implement.** In `components/DocumentView.tsx`:

(a) Extend the type import:

```ts
import type { PresenceEntry, PresenceSelection } from "@/lib/events";
```

(b) Add refs + the send/throttle plumbing right after the `roster` state declaration (after line 90):

```ts
  const selectionRef = useRef<PresenceSelection | null>(null);
  const versionRef = useRef(versionNumber);
  useEffect(() => {
    versionRef.current = versionNumber;
  }, [versionNumber]);

  // One presence channel for heartbeats AND selection updates: every POST
  // states the full selection truth (object sets, null clears).
  const sendPresence = useCallback(() => {
    fetch(`/api/documents/${doc.id}/presence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selection: selectionRef.current }),
      keepalive: true,
    }).catch(() => {});
  }, [doc.id]);

  // Leading+trailing throttle so drag-selections feel live without spamming.
  const throttleRef = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null }>({ last: 0, timer: null });
  const queueSelectionSend = useCallback(() => {
    const throttleMs = Number(process.env.NEXT_PUBLIC_PRESENCE_SELECTION_THROTTLE_MS ?? 250);
    const t = throttleRef.current;
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

(c) Replace the `selectionchange` effect (`:102-121`) with (the `PendingSelection` logic is unchanged; only the ref bookkeeping and clear-path are new):

```ts
  // Capture text selections via selectionchange so both real pointer selection
  // and programmatic selection (Playwright selectText) are picked up.
  useEffect(() => {
    function onSelectionChange() {
      const sel = document.getSelection();
      const container = containerRef.current;
      const clearShared = () => {
        if (selectionRef.current !== null) {
          selectionRef.current = null;
          queueSelectionSend();
        }
      };
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !container) return clearShared();
      const range = sel.getRangeAt(0);
      if (!container.contains(range.startContainer)) return clearShared();
      const selectedText = sel.toString();
      if (!selectedText.trim()) return clearShared();
      const pre = document.createRange();
      pre.selectNodeContents(container);
      pre.setEnd(range.startContainer, range.startOffset);
      const start = pre.toString().length;
      const end = start + selectedText.length;
      const containerText = container.textContent ?? "";
      setSelection({ quote: buildQuote(containerText, start, end), startOffset: start, endOffset: end });
      selectionRef.current = { start, end, versionNumber: versionRef.current };
      queueSelectionSend();
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [queueSelectionSend]);
```

(d) Replace the heartbeat effect (`:294-317`) with:

```ts
  // Presence heartbeat: ride a throttled POST beacon (NOT a third EventSource).
  useEffect(() => {
    const url = `/api/documents/${doc.id}/presence`;
    const leave = () => {
      const blob = new Blob([JSON.stringify({ leaving: true })], { type: "application/json" });
      navigator.sendBeacon?.(url, blob);
    };
    sendPresence();
    const intervalMs = Number(process.env.NEXT_PUBLIC_PRESENCE_HEARTBEAT_MS ?? 10_000);
    const timer = setInterval(sendPresence, intervalMs);
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(timer);
      const t = throttleRef.current;
      if (t.timer) {
        clearTimeout(t.timer);
        t.timer = null;
      }
      window.removeEventListener("pagehide", leave);
      leave(); // best-effort fast departure on unmount
    };
  }, [doc.id, sendPresence]);
```

- [ ] **Step 2: Verify**

Run: `pnpm lint && pnpm test:unit`
Expected: green. (The old `send()` helper is gone; `sendPresence` is its replacement.)

- [ ] **Step 3: Commit**

```bash
git add components/DocumentView.tsx
git commit -m "feat(m5-p2): selection rides the presence beacon with a leading+trailing throttle"
```

---

### Task 6: DocumentView renders remote selections

**Goal:** Remote selections from the roster appear as tinted marks in review mode and clear in edit mode, via a driver effect independent of the annotation-highlight effect.

**Files:**
- Modify: `components/DocumentView.tsx` (new effect after the annotation-highlight effect `:124-131`; imports)

**Acceptance Criteria:**
- [ ] Roster changes re-apply `mark[data-presence-user-id]` marks without touching `mark[data-annotation-id]`
- [ ] Edit mode clears remote selection marks; returning to review re-applies them
- [ ] Self and version-mismatched selections never render (via `remoteSelections`)

**Verify:** `pnpm lint && pnpm test:unit` green (behavioral coverage in Task 7's e2e)

**Steps:**

- [ ] **Step 1: Implement.** Extend the imports in `components/DocumentView.tsx`:

```ts
import { applyHighlights, applyPresenceSelections, buildHighlightRanges, clearPresenceSelections } from "@/lib/highlight";
import { applyPresenceEvent, remoteSelections } from "@/lib/presence-client";
```

Add directly after the annotation-highlight effect (`:124-131`):

```ts
  // Render other users' live selections as a separate direct-DOM mark layer
  // (kept out of the memoized RenderedMarkdown subtree, like annotation
  // highlights). Independent of the annotation effect so selection churn
  // never rewraps annotation marks.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (mode !== "review") {
      clearPresenceSelections(container);
      return;
    }
    applyPresenceSelections(container, remoteSelections(roster, currentUserId, versionNumber));
  }, [roster, versionNumber, markdown, mode, currentUserId]);
```

- [ ] **Step 2: Verify**

Run: `pnpm lint && pnpm test:unit`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add components/DocumentView.tsx
git commit -m "feat(m5-p2): render remote selections as tinted presence marks"
```

---

### Task 7: Two-context e2e + full verification gates

**Goal:** Prove the feature end-to-end in two browser contexts and leave the branch green on all repo gates.

**USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

**Files:**
- Create: `tests/e2e/selections.spec.ts`

**Acceptance Criteria:**
- [ ] Two-context e2e: B selects → A sees `mark[data-presence-user-id]` with `data-user-name="Grace"`, `title="Grace"`, and the selected text; B sees no remote mark for itself
- [ ] B collapses the selection → A's mark disappears
- [ ] A remote selection and an annotation highlight coexist on the same page
- [ ] `pnpm test:unit`, `pnpm test:e2e`, `pnpm lint` all green (captured output)

**Verify:** `pnpm test:unit && pnpm lint && pnpm test:e2e` → 0 failures

**Steps:**

- [ ] **Step 1: Write the spec.** Create `tests/e2e/selections.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";

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

test("remote selection appears as a tinted mark and clears on collapse", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await register(pageA, "Ada");
  const docUrl = await createDoc(pageA, "Selection demo", "# Hello\n\nReview me together.\n\nAnother paragraph here.");

  await register(pageB, "Grace");
  await pageB.goto(docUrl);
  await expect(pageB.getByTestId("doc-body")).toBeVisible();
  // Both in the roster → SSE channel is live on both sides.
  await expect(pageA.getByTestId("presence-roster")).toHaveAttribute("aria-label", /2 people viewing/);

  // B selects a sentence; A sees a presence mark carrying B's name.
  await pageB.getByTestId("doc-body").getByText("Review me together.").first().selectText();
  const remoteMark = pageA.locator("mark[data-presence-user-id]");
  await expect(remoteMark).toHaveCount(1);
  await expect(remoteMark).toHaveAttribute("data-user-name", "Grace");
  await expect(remoteMark).toHaveAttribute("title", "Grace");
  await expect(remoteMark).toHaveText("Review me together.");
  // B never renders its own selection as a remote mark.
  await expect(pageB.locator("mark[data-presence-user-id]")).toHaveCount(0);

  // B collapses; A's mark disappears.
  await pageB.evaluate(() => document.getSelection()?.removeAllRanges());
  await expect(remoteMark).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

test("remote selection coexists with an annotation highlight", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await register(pageA, "Ada");
  const docUrl = await createDoc(pageA, "Coexistence demo", "The cloud setup needs review before launch.\n\nReview me together.");

  // A creates an annotation (mirrors review.spec.ts).
  await pageA.getByTestId("doc-body").getByText("cloud setup").first().selectText();
  await pageA.getByLabel("comment").fill("which cloud provider?");
  await pageA.getByRole("button", { name: "Comment" }).click();
  await expect(pageA.locator("mark[data-annotation-id]")).toHaveCount(1);

  await register(pageB, "Grace");
  await pageB.goto(docUrl);
  await expect(pageB.getByTestId("doc-body")).toBeVisible();
  await expect(pageA.getByTestId("presence-roster")).toHaveAttribute("aria-label", /2 people viewing/);

  // B selects the other paragraph; A sees both layers at once.
  await pageB.getByTestId("doc-body").getByText("Review me together.").first().selectText();
  await expect(pageA.locator("mark[data-presence-user-id]")).toHaveCount(1);
  await expect(pageA.locator("mark[data-annotation-id]")).toHaveCount(1);

  await ctxA.close();
  await ctxB.close();
});
```

- [ ] **Step 2: Run the new spec**

Run: `pnpm test:e2e -- tests/e2e/selections.spec.ts`
Expected: 2 passed. (The Playwright web server already carries test-tuned presence env: heartbeat 1s, TTL 4s, sweep 1s.)

- [ ] **Step 3: Run ALL gates, capture output**

Run: `pnpm test:unit && pnpm lint && pnpm test:e2e`
Expected: unit 0 failures, lint clean, e2e 0 failures. Capture the summary lines as close-time evidence.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/selections.spec.ts
git commit -m "test(m5-p2): two-context shared-selections e2e"
```

---

## Post-plan: PR

After all tasks complete and gates are green (handled by the finishing-a-development-branch skill): push the branch and open a PR against `main` titled `feat(m5-p2): shared selections`.
