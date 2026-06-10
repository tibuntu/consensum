# M5 P5 — Follow-the-Leader Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a review session is active, the session leader's vertical scroll position broadcasts to followers, who auto-follow (smooth-scroll to match), detach on a manual scroll, and resume with one click.

**Architecture:** Leader scroll rides the **existing P3 presence beacon** as a new leader-gated `scroll` field on `PresenceEntry`, fanned out via the existing `presence.updated`/`presence.sync` events — no new transport, no new `DocEvent`, no third `EventSource`. A pure `lib/follow-client.ts` selects the leader's scroll and computes the follower's target `scrollTop`; `DocumentView` wires the send (leader) and the attach/detach/resume follow loop (followers); `SessionBanner` shows the follow affordance.

**Tech Stack:** Next.js (App Router) standalone server, React 19, TypeScript, in-memory presence/session registries on the `lib/events.ts` event bus, Vitest (node env) for units, Playwright (two browser contexts) for e2e.

**Design spec:** `docs/superpowers/specs/2026-06-10-quorum-ai-m5-p5-follow-the-leader-design.md`

---

### Task 1: `scroll` field on the presence entry + registry

**Goal:** Add the normalized `PresenceScroll` type and let `heartbeat` store/clear a `scroll` on the presence entry, full-truth like P3's cursor.

**Files:**
- Modify: `lib/events.ts` (add `PresenceScroll`; add `scroll?` to `PresenceEntry`)
- Modify: `lib/presence.ts` (re-export `PresenceScroll`; `heartbeat` gains a 5th `scroll?` arg)
- Test: `tests/unit/presence.test.ts` (append scroll cases)

**Acceptance Criteria:**
- [ ] `PresenceScroll = { y: number }` is exported from `lib/events.ts` and re-exported from `lib/presence.ts`.
- [ ] `PresenceEntry` has an optional `scroll?: PresenceScroll`.
- [ ] `heartbeat(docId, user, selection?, cursor?, scroll?)` stores `scroll` when an object is passed and omits it when `null`/`undefined`.
- [ ] `scroll` coexists on one entry with `selection` and `cursor`.

**Verify:** `CI=true pnpm test:unit tests/unit/presence.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Write the failing tests** — append to `tests/unit/presence.test.ts`:

```ts
describe("presence scroll (P5)", () => {
  it("heartbeat stores a scroll and a later heartbeat without one clears it", () => {
    heartbeat("p-scroll-1", { userId: "u1", name: "Ada" }, null, null, { y: 0.4 });
    expect(roster("p-scroll-1")[0].scroll).toEqual({ y: 0.4 });
    heartbeat("p-scroll-1", { userId: "u1", name: "Ada" });
    expect(roster("p-scroll-1")[0].scroll).toBeUndefined();
  });

  it("scroll coexists with selection and cursor on one entry", () => {
    heartbeat(
      "p-scroll-2",
      { userId: "u1", name: "Ada" },
      { start: 1, end: 4, versionNumber: 2 },
      { x: 0.1, y: 0.2 },
      { y: 0.75 },
    );
    const entry = roster("p-scroll-2")[0];
    expect(entry.selection).toEqual({ start: 1, end: 4, versionNumber: 2 });
    expect(entry.cursor).toEqual({ x: 0.1, y: 0.2 });
    expect(entry.scroll).toEqual({ y: 0.75 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `CI=true pnpm test:unit tests/unit/presence.test.ts`
Expected: FAIL — `heartbeat` rejects a 5th arg / `entry.scroll` is always undefined.

- [ ] **Step 3: Add the type in `lib/events.ts`** — after the `PresenceCursor` interface (`:19-22`):

```ts
export interface PresenceScroll {
  y: number; // 0..1 fraction of the doc-body box height (leader viewport-top position)
}
```

And add the field to `PresenceEntry` (after the `cursor?` line, `:29`):

```ts
  scroll?: PresenceScroll; // present only while this user is a session leader broadcasting scroll
```

- [ ] **Step 4: Thread it through `lib/presence.ts`** — extend the import/re-export (`:1-3`):

```ts
import { publish, type PresenceEntry, type PresenceCursor, type PresenceSelection, type PresenceScroll } from "@/lib/events";

export type { PresenceEntry, PresenceCursor, PresenceSelection, PresenceScroll };
```

Extend `heartbeat`'s signature and body (`:18-34`) — add the 5th param and set it:

```ts
export function heartbeat(
  documentId: string,
  user: { userId: string; name: string },
  selection?: PresenceSelection | null,
  cursor?: PresenceCursor | null,
  scroll?: PresenceScroll | null,
): void {
  let docMap = registry.get(documentId);
  if (!docMap) {
    docMap = new Map();
    registry.set(documentId, docMap);
  }
  const entry: PresenceEntry = { userId: user.userId, name: user.name, lastSeen: Date.now() };
  if (selection) entry.selection = selection;
  if (cursor) entry.cursor = cursor;
  if (scroll) entry.scroll = scroll;
  docMap.set(user.userId, entry);
  publish(documentId, { type: "presence.updated", entry });
}
```

- [ ] **Step 5: Run to verify pass**

Run: `CI=true pnpm test:unit tests/unit/presence.test.ts`
Expected: PASS (new + existing presence tests green).

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add lib/events.ts lib/presence.ts tests/unit/presence.test.ts
/usr/bin/git commit -m "feat(m5-p5): presence scroll field + heartbeat 5th arg"
```

---

### Task 2: Beacon route `parseScroll` validation

**Goal:** Validate and forward an optional `scroll` on the presence beacon, mirroring `parseCursor`; malformed → 400 with no side effect.

**Files:**
- Modify: `app/api/documents/[id]/presence/route.ts` (add `parseScroll`; wire into `POST`; pass as the 5th `heartbeat` arg)
- Test: `tests/unit/presence.route.test.ts` (update existing 4-arg `heartbeat` assertions to 5-arg; add scroll matrix)

**Acceptance Criteria:**
- [ ] A valid `{ y }` with `y` finite in `[0,1]` → 204 and forwarded to `heartbeat` as the 5th arg.
- [ ] `y` out of `[0,1]`, non-finite (NaN/Infinity), non-number, or a missing `y` → 400, `heartbeat` NOT called.
- [ ] Absent/`null` `scroll` → 204 with `scroll` forwarded as `null`.
- [ ] Existing selection/cursor passthrough and leaving/name tests still pass (now with a 5th `heartbeat` arg).

**Verify:** `CI=true pnpm test:unit tests/unit/presence.route.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Update existing assertions + add failing scroll tests** in `tests/unit/presence.route.test.ts`.

  First, every existing `expect(presence.heartbeat).toHaveBeenCalledWith(...)` call currently ends with `..., null, null)` (selection, cursor). Append one more `null` (scroll) to each so they read `..., null, null, null)`, and for the selection/cursor passthrough tests append a trailing `null`. For example the plain-heartbeat assertion becomes:

```ts
    expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "Ada" }, null, null, null);
```

  Then append this new block:

```ts
describe("scroll validation (P5)", () => {
  beforeEach(() => {
    vi.mocked(api.requireUser).mockResolvedValue({ id: "u1", name: "Ada" } as never);
    vi.mocked(authz.isParticipant).mockResolvedValue(true);
  });

  it("forwards a valid scroll as the 5th heartbeat arg", async () => {
    const res = await POST(req({ scroll: { y: 0.5 } }), ctx);
    expect(res.status).toBe(204);
    expect(presence.heartbeat).toHaveBeenCalledWith("doc1", { userId: "u1", name: "Ada" }, null, null, { y: 0.5 });
  });

  it.each([
    ["y above 1", { y: 1.5 }],
    ["y below 0", { y: -0.1 }],
    ["y NaN", { y: Number.NaN }],
    ["y Infinity", { y: Number.POSITIVE_INFINITY }],
    ["y non-number", { y: "x" }],
    ["missing y", {}],
  ])("rejects %s with 400 and no heartbeat", async (_label, scroll) => {
    const res = await POST(req({ scroll }), ctx);
    expect(res.status).toBe(400);
    expect(presence.heartbeat).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `CI=true pnpm test:unit tests/unit/presence.route.test.ts`
Expected: FAIL — valid scroll not forwarded (4-arg call), invalid scroll returns 204 not 400.

- [ ] **Step 3: Implement `parseScroll` and wire it in** `app/api/documents/[id]/presence/route.ts`.

  Update the import (`:4`) to pull in the type:

```ts
import { heartbeat, leave, type PresenceSelection, type PresenceCursor, type PresenceScroll } from "@/lib/presence";
```

  Add `parseScroll` after `parseCursor` (`:30`):

```ts
/** null = no scroll; "invalid" = malformed payload (reject with 400). */
function parseScroll(raw: unknown): PresenceScroll | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "invalid";
  const { y } = raw as Record<string, unknown>;
  if (typeof y !== "number" || !Number.isFinite(y)) return "invalid";
  if (y < 0 || y > 1) return "invalid";
  return { y } as PresenceScroll;
}
```

  In `POST`, after the cursor parse/guard (`:45-46`), add the scroll parse and pass it to `heartbeat` (`:48`):

```ts
  const scroll = parseScroll(body?.scroll);
  if (scroll === "invalid") return NextResponse.json({ error: "invalid scroll" }, { status: 400 });
  const name = (user.name && user.name.trim()) || user.email || "Someone";
  heartbeat(id, { userId: user.id, name }, selection, cursor, scroll);
  return new Response(null, { status: 204 });
```

- [ ] **Step 4: Run to verify pass**

Run: `CI=true pnpm test:unit tests/unit/presence.route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add "app/api/documents/[id]/presence/route.ts" tests/unit/presence.route.test.ts
/usr/bin/git commit -m "feat(m5-p5): validate scroll on the presence beacon"
```

---

### Task 3: `lib/follow-client.ts` pure helpers

**Goal:** Pure, React-free selection of the leader's scroll for a follower, plus the follower's target-scrollTop arithmetic — both unit-tested.

**Files:**
- Create: `lib/follow-client.ts`
- Test: `tests/unit/follow-client.test.ts`

**Acceptance Criteria:**
- [ ] `leaderScroll(roster, session, selfId)` returns the leader's `scroll.y` ONLY when there is a session, `selfId` is a participant, `selfId !== leaderId`, and the leader's roster entry has a `scroll`; otherwise `null`.
- [ ] `scrollTargetTop(scrollY, rectTop, rectHeight, frac)` returns `scrollY + rectTop + frac * rectHeight`.

**Verify:** `CI=true pnpm test:unit tests/unit/follow-client.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Write the failing tests** — create `tests/unit/follow-client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { leaderScroll, scrollTargetTop } from "@/lib/follow-client";
import type { PresenceEntry, ReviewSession } from "@/lib/events";

function session(leaderId: string, participantIds: string[]): ReviewSession {
  return {
    sessionId: "s1",
    documentId: "d1",
    leaderId,
    leaderName: "Ada",
    participants: participantIds.map((userId) => ({ userId, name: userId, joinedAt: 0 })),
    startedAt: 0,
  };
}
function entry(userId: string, scroll?: { y: number }): PresenceEntry {
  return { userId, name: userId, lastSeen: 0, ...(scroll ? { scroll } : {}) };
}

describe("leaderScroll", () => {
  const roster = [entry("leader", { y: 0.6 }), entry("follower")];

  it("returns the leader's scroll for a non-leader participant", () => {
    expect(leaderScroll(roster, session("leader", ["leader", "follower"]), "follower")).toBe(0.6);
  });
  it("returns null for the leader themselves", () => {
    expect(leaderScroll(roster, session("leader", ["leader", "follower"]), "leader")).toBeNull();
  });
  it("returns null for a non-participant", () => {
    expect(leaderScroll(roster, session("leader", ["leader"]), "outsider")).toBeNull();
  });
  it("returns null when there is no session", () => {
    expect(leaderScroll(roster, null, "follower")).toBeNull();
  });
  it("returns null when the leader has no scroll yet", () => {
    expect(leaderScroll([entry("leader"), entry("follower")], session("leader", ["leader", "follower"]), "follower")).toBeNull();
  });
});

describe("scrollTargetTop", () => {
  it("decodes the fraction into an absolute scrollTop", () => {
    expect(scrollTargetTop(100, -50, 2000, 0.5)).toBe(100 + -50 + 1000);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `CI=true pnpm test:unit tests/unit/follow-client.test.ts`
Expected: FAIL — module `@/lib/follow-client` not found.

- [ ] **Step 3: Implement** `lib/follow-client.ts`:

```ts
import type { PresenceEntry, ReviewSession } from "@/lib/events";

/** The session leader's vertical scroll fraction, but only for a non-leader participant
 *  of an active session whose leader is currently broadcasting a scroll. Else null. */
export function leaderScroll(
  roster: PresenceEntry[],
  session: ReviewSession | null,
  selfId: string,
): number | null {
  if (!session) return null;
  if (selfId === session.leaderId) return null;
  if (!session.participants.some((p) => p.userId === selfId)) return null;
  const leaderEntry = roster.find((e) => e.userId === session.leaderId);
  return leaderEntry?.scroll?.y ?? null;
}

/** Absolute window scrollTop that places `frac` of the doc-body box at the viewport top,
 *  given the box's current viewport-relative top and height. Inverse of the leader encode. */
export function scrollTargetTop(scrollY: number, rectTop: number, rectHeight: number, frac: number): number {
  return scrollY + rectTop + frac * rectHeight;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `CI=true pnpm test:unit tests/unit/follow-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add lib/follow-client.ts tests/unit/follow-client.test.ts
/usr/bin/git commit -m "feat(m5-p5): follow-client leaderScroll + scrollTargetTop helpers"
```

---

### Task 4: Client follow integration — `SessionBanner` + `DocumentView`

**Goal:** Leader broadcasts scroll on the beacon; non-leader participants auto-follow, detach on manual scroll, and resume via the banner.

**Files:**
- Modify: `components/SessionBanner.tsx` (add `followAttached` + `onResumeFollow` props and the follow affordance)
- Modify: `components/DocumentView.tsx` (leader scroll send; follower attach/detach/resume; pass banner props)

**Acceptance Criteria:**
- [ ] A non-leader participant sees `following-indicator` (text "Following {leaderName}") while attached, and `resume-following` (a button) while detached.
- [ ] While leading in review mode, the leader's window-scroll fraction is sent on the beacon (`scroll: { y }`); when not leading / in edit mode, `scroll` is `null`.
- [ ] A follower auto-scrolls toward the leader's position; a manual (non-programmatic) scroll sets the follower detached; "Resume" re-attaches and jumps to the leader's current position.
- [ ] `pnpm tsc`, `pnpm lint`, and the full `pnpm test:unit` suite stay green.

**Verify:** `CI=true pnpm tsc --noEmit && CI=true pnpm lint && CI=true pnpm test:unit` → all PASS

**Steps:**

- [ ] **Step 1: Rewrite `components/SessionBanner.tsx`** to accept the follow props and render the affordance for a non-leader participant. Full file:

```tsx
"use client";
import { Button } from "@/components/ui/Button";
import type { ReviewSession } from "@/lib/events";
import { isLeader, isInSession, canStart } from "@/lib/session-client";
import type { SessionAction } from "@/lib/enums";

export default function SessionBanner({
  session,
  currentUserId,
  onAction,
  pending,
  followAttached,
  onResumeFollow,
}: {
  session: ReviewSession | null;
  currentUserId: string;
  onAction: (action: SessionAction) => void;
  pending: boolean;
  followAttached: boolean;
  onResumeFollow: () => void;
}) {
  if (canStart(session)) {
    return (
      <Button
        variant="secondary"
        size="sm"
        data-testid="start-session"
        disabled={pending}
        onClick={() => onAction("start")}
      >
        Start session
      </Button>
    );
  }

  const s = session!;
  const leader = isLeader(s, currentUserId);
  const joined = isInSession(s, currentUserId);
  const count = s.participants.length;

  return (
    <div
      data-testid="session-banner"
      className="flex items-center gap-2 rounded-[var(--radius-app)] border border-border bg-surface px-3 py-1 text-sm"
    >
      {leader ? (
        <span>
          You&apos;re leading · <span data-testid="session-participant-count">{count}</span> participant
          {count === 1 ? "" : "s"}
        </span>
      ) : (
        <span>
          <span data-testid="session-leader-name">{s.leaderName}</span> is leading a review session ·{" "}
          <span data-testid="session-participant-count">{count}</span> in session
        </span>
      )}
      {joined && !leader &&
        (followAttached ? (
          <span data-testid="following-indicator" className="text-muted">
            Following {s.leaderName}
          </span>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            data-testid="resume-following"
            disabled={pending}
            onClick={onResumeFollow}
          >
            Jump back to {s.leaderName} · Resume
          </Button>
        ))}
      {leader ? (
        <Button variant="danger" size="sm" data-testid="end-session" disabled={pending} onClick={() => onAction("end")}>
          End session
        </Button>
      ) : joined ? (
        <Button variant="secondary" size="sm" data-testid="leave-session" disabled={pending} onClick={() => onAction("leave")}>
          Leave
        </Button>
      ) : (
        <Button variant="secondary" size="sm" data-testid="join-session" disabled={pending} onClick={() => onAction("join")}>
          Join
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update `DocumentView.tsx` imports** (`:9-15`):

  Add `isLeader, isInSession` to the session-client import, the follow-client import, and `PresenceScroll` to the events type import:

```tsx
import { applySessionEvent, isLeader, isInSession } from "@/lib/session-client";
import { leaderScroll, scrollTargetTop } from "@/lib/follow-client";
```

```tsx
import type { PresenceEntry, PresenceCursor, PresenceSelection, PresenceScroll, ReviewSession } from "@/lib/events";
```

- [ ] **Step 3a: Declare the scroll ref alongside the other beacon refs** so it exists before `sendPresence` reads it. Immediately after `cursorRef` (`:113`), add:

```tsx
  const scrollRef = useRef<PresenceScroll | null>(null);
```

- [ ] **Step 3b: Add the follow state, programmatic-scroll guard, and scroll throttle.** After the existing `cursorThrottleRef`/`queueCursorSend` block (`:150-165`), add:

```tsx
  // P5 follow-the-leader: leader broadcasts scroll; followers auto-scroll.
  const programmaticScrollRef = useRef(false);
  const [attached, setAttached] = useState(true);

  const scrollThrottleRef = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null }>({ last: 0, timer: null });
  const queueScrollSend = useCallback(() => {
    const throttleMs = Number(process.env.NEXT_PUBLIC_PRESENCE_SCROLL_THROTTLE_MS ?? 100);
    const t = scrollThrottleRef.current;
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

- [ ] **Step 4: Include `scroll` in the beacon body.** Update `sendPresence` (`:121-128`) so the POST states the full truth of all three refs:

```tsx
  const sendPresence = useCallback(() => {
    fetch(`/api/documents/${doc.id}/presence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selection: selectionRef.current, cursor: cursorRef.current, scroll: scrollRef.current }),
      keepalive: true,
    }).catch(() => {});
  }, [doc.id]);
```

- [ ] **Step 5: Add the derived follow values + leader send effect + follower effects.** Place these after the cursor `mousemove` effect (`:273`). First derive role/target near the other derived values:

```tsx
  const leading = isLeader(session, currentUserId);
  const joinedSession = isInSession(session, currentUserId);
  const targetScroll = leaderScroll(roster, session, currentUserId);
```

  Leader send effect — track window scroll while leading in review mode; clear once when leadership ends:

```tsx
  // Leader: broadcast viewport-top as a fraction of the doc-body box (P5).
  useEffect(() => {
    if (mode !== "review" || !leading) {
      if (scrollRef.current !== null) {
        scrollRef.current = null;
        sendPresence(); // one-shot clear so a former leader's scroll doesn't linger
      }
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const throttle = scrollThrottleRef.current;
    const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
    const onScroll = () => {
      const rect = container.getBoundingClientRect();
      if (rect.height === 0) return;
      scrollRef.current = { y: clamp01(-rect.top / rect.height) };
      queueScrollSend();
    };
    onScroll(); // send initial position on becoming leader
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (throttle.timer) {
        clearTimeout(throttle.timer);
        throttle.timer = null;
      }
    };
  }, [mode, leading, queueScrollSend, sendPresence]);
```

  Reset `attached` to true on each fresh join:

```tsx
  const wasJoinedRef = useRef(false);
  useEffect(() => {
    if (joinedSession && !wasJoinedRef.current) setAttached(true);
    wasJoinedRef.current = joinedSession;
  }, [joinedSession]);
```

  Follower auto-scroll — when attached and the leader's target changes, smooth-scroll, guarding against self-detach:

```tsx
  useEffect(() => {
    if (!attached || targetScroll === null) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.height === 0) return;
    programmaticScrollRef.current = true;
    window.scrollTo({ top: scrollTargetTop(window.scrollY, rect.top, rect.height, targetScroll), behavior: "smooth" });
    const clear = () => { programmaticScrollRef.current = false; };
    window.addEventListener("scrollend", clear, { once: true });
    const fallback = setTimeout(clear, 1000);
    return () => {
      window.removeEventListener("scrollend", clear);
      clearTimeout(fallback);
    };
  }, [attached, targetScroll]);
```

  Detach on a manual (non-programmatic) scroll:

```tsx
  useEffect(() => {
    const onScroll = () => {
      if (programmaticScrollRef.current) return;
      setAttached(false);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const resumeFollow = useCallback(() => setAttached(true), []);
```

- [ ] **Step 6: Pass the follow props to `SessionBanner`** (`:543-548`):

```tsx
          <SessionBanner
            session={session}
            currentUserId={currentUserId}
            onAction={postSessionAction}
            pending={sessionPending}
            followAttached={attached}
            onResumeFollow={resumeFollow}
          />
```

- [ ] **Step 7: Verify typecheck, lint, and units**

Run: `CI=true pnpm tsc --noEmit && CI=true pnpm lint && CI=true pnpm test:unit`
Expected: all PASS. (If `tsc` flags an unused import, remove only the genuinely unused one — `isInSession`/`isLeader`/`leaderScroll`/`scrollTargetTop`/`PresenceScroll` are all used above.)

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add components/SessionBanner.tsx components/DocumentView.tsx
/usr/bin/git commit -m "feat(m5-p5): leader scroll broadcast + follower auto-follow/resume"
```

---

### Task 5: E2E — `tests/e2e/follow.spec.ts`

**Goal:** Prove follow-the-leader end-to-end across two browser contexts: auto-follow, scroll tracking, manual-scroll detach, resume, session-end teardown, and the 2-EventSource cap.

**Files:**
- Create: `tests/e2e/follow.spec.ts`

**Acceptance Criteria:**
- [ ] A starts a session and B joins → B sees `following-indicator`.
- [ ] A scrolls down → B's `window.scrollY` increases (tracks the leader) within the timeout.
- [ ] B scrolls manually → `resume-following` appears and further A-scrolling no longer moves B.
- [ ] B clicks `resume-following` → re-attaches and B's `window.scrollY` tracks A again.
- [ ] A ends the session → B's follow UI (`following-indicator` and `resume-following`) is gone.
- [ ] A's tab holds exactly **2** EventSource connections.

**Verify:** `CI=true pnpm test:e2e tests/e2e/follow.spec.ts` → PASS (free port 3000 first)

**Steps:**

- [ ] **Step 1: Write the spec** — create `tests/e2e/follow.spec.ts`. The doc body must be tall enough to scroll, so the markdown repeats many paragraphs.

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

const TALL_MARKDOWN = "# Follow me\n\n" + Array.from({ length: 80 }, (_, i) => `Paragraph ${i} — lorem ipsum dolor sit amet, consectetur adipiscing elit.`).join("\n\n");
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

test("follower tracks the leader, detaches on manual scroll, and resumes", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  await countEventSources(ctxA);
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await register(pageA, "Ada");
  await pageA.goto("/app");
  await pageA.getByLabel("title").fill("Follow demo");
  await pageA.getByLabel("markdown").fill(TALL_MARKDOWN);
  await pageA.getByRole("button", { name: "Create document" }).click();
  await expect(pageA).toHaveURL(/\/app\/documents\/[^/]+$/);
  const docUrl = pageA.url();

  await register(pageB, "Grace");
  await pageB.goto(docUrl);
  await expect(pageB.getByTestId("doc-body")).toBeVisible();

  // A leads, B joins -> B auto-follows.
  await pageA.getByTestId("start-session").click();
  await pageB.getByTestId("join-session").click();
  await expect(pageB.getByTestId("following-indicator")).toBeVisible();

  // A scrolls down -> B tracks.
  await pageA.evaluate(() => window.scrollTo({ top: 1200 }));
  await expect.poll(() => scrollY(pageB), { timeout: 10_000 }).toBeGreaterThan(300);

  // B scrolls manually -> detaches; A scrolling no longer moves B.
  await pageB.evaluate(() => window.scrollTo({ top: 0 }));
  await expect(pageB.getByTestId("resume-following")).toBeVisible();
  await pageA.evaluate(() => window.scrollTo({ top: 2400 }));
  await pageB.waitForTimeout(1500);
  expect(await scrollY(pageB)).toBeLessThan(300);

  // B resumes -> tracks A again.
  await pageB.getByTestId("resume-following").click();
  await expect.poll(() => scrollY(pageB), { timeout: 10_000 }).toBeGreaterThan(300);
  await expect(pageB.getByTestId("following-indicator")).toBeVisible();

  // Exactly two EventSources in A's tab.
  expect(await pageA.evaluate(() => (window as unknown as { __esCount: number }).__esCount)).toBe(2);

  // A ends the session -> B's follow UI clears.
  await pageA.getByTestId("end-session").click();
  await expect(pageB.getByTestId("following-indicator")).toHaveCount(0);
  await expect(pageB.getByTestId("resume-following")).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
```

- [ ] **Step 2: Free port 3000, then run the spec**

Run: `lsof -ti:3000 | xargs kill -9 2>/dev/null; CI=true pnpm test:e2e tests/e2e/follow.spec.ts`
Expected: 1 passed. (If the tracking assertion is flaky on a slow machine, raise the `expect.poll` timeout — do not lower the scroll distance, which would weaken the assertion.)

- [ ] **Step 3: Commit**

```bash
/usr/bin/git add tests/e2e/follow.spec.ts
/usr/bin/git commit -m "test(m5-p5): e2e follow-the-leader scroll, detach, resume"
```

---

## Final gates (before PR)

- [ ] `lsof -ti:3000 | xargs kill -9 2>/dev/null; CI=true pnpm test:unit && CI=true pnpm test:e2e && CI=true pnpm lint` → all green.
- [ ] A tab still holds exactly 2 EventSource connections (asserted in the e2e).
- [ ] Open a PR (the executing skill handles the PR step).
