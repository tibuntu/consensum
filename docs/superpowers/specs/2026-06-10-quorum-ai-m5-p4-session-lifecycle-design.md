# Quorum AI — M5 Phase 4: Session Lifecycle (Design)

> **Status:** Approved design spec. Phase 4 of the M5 "Real-Time Review Sessions" milestone.
> **Roadmap:** `docs/superpowers/specs/2026-06-09-quorum-ai-m5-roadmap.md` → P4.
> **Depends on:** P1 (presence roster), shipped on `main`. Builds the leader concept that P5 (follow-the-leader scroll) consumes.

## Goal

Add an explicit, ephemeral **review session** to a document: any participant can start one, it has a single **leader** (the starter) and a **session-scoped participant list distinct from ambient presence**, and it ends when the leader ends it or disconnects. This is the leader + sessionId substrate P5 builds on. No persistence, no history, no follow-the-leader scrolling (P5).

## Decisions (resolved during brainstorming)

| Decision | Choice |
| --- | --- |
| Who can start | Any document participant; the starter becomes leader. |
| Concurrency | **One active session per document.** Starting is rejected while one is live. |
| Joining | **Explicit "Join" action.** Session membership is separate from the presence roster. Leader is auto-joined on start. |
| Ending | Leader ends explicitly; session also **auto-ends if the leader disconnects** (P5 needs a live leader). |
| Storage | **Approach A:** a dedicated in-memory module (`lib/review-session.ts`), sibling to `lib/presence.ts`. Same single-instance/in-memory pattern and same event bus — not literally the same `Map`. |
| Persistence | None. Ephemeral, single-instance, in-memory (matches the milestone's deferred Postgres/multi-instance scope). |

## Architecture

Two focused, independently-testable layers, each mirroring the existing presence implementation:

```
lib/events.ts          ── DocEvent union + ReviewSession/SessionParticipant types (base, no deps)
lib/review-session.ts  ── in-memory registry + lifecycle fns + leader-drop sweep   (depends on events + presence.roster)
lib/presence.ts        ── unchanged (review-session reads roster() one-way)
app/api/documents/[id]/session/route.ts   ── thin action route (authz → registry)
app/api/documents/[id]/stream/route.ts    ── also replays an active session on connect
lib/session-client.ts  ── pure reducer + predicates (client mirror of presence-client.ts)
components/SessionBanner.tsx               ── header UI, four states
components/DocumentView.tsx                ── session state + event switch + POST actions
```

**Dependency direction:** `review-session` → `presence` (one-way, to read the roster for leader/participant liveness). `events.ts` stays dependency-free so both presence and session can import its types.

## Data model (`lib/events.ts`)

Defined in `events.ts` alongside `PresenceEntry` so both server and client import without cycles.

```ts
export interface SessionParticipant {
  userId: string;
  name: string;
  joinedAt: number; // epoch ms
}

export interface ReviewSession {
  sessionId: string;   // crypto.randomUUID()
  documentId: string;
  leaderId: string;
  leaderName: string;
  participants: SessionParticipant[]; // includes the leader; ordered by joinedAt
  startedAt: number;   // epoch ms
}
```

## Registry & lifecycle (`lib/review-session.ts`)

`globalThis`-stashed `Map<documentId, ReviewSession>` singleton (survives dev hot-reload), exactly like `lib/presence.ts:7-13`. One session per document.

- `startSession(documentId, leader: {userId, name}): ReviewSession | null`
  Returns `null` if a session already exists for the document (one-at-a-time). Otherwise creates a session with the leader auto-joined as the first participant, stores it, publishes `session.started`, returns the snapshot.
- `joinSession(documentId, user: {userId, name}): ReviewSession | null`
  Returns `null` if no active session. If the user is already a participant, no-op upsert (idempotent — handles double-click / retry). Otherwise appends a participant, publishes `session.updated`, returns the snapshot.
- `leaveSession(documentId, userId): void`
  If the user is the **leader**, this ends the session (delegates to `endSession`). Otherwise removes the participant and publishes `session.updated`. No-op if no session or not a participant.
- `endSession(documentId, userId): boolean`
  Only the `leaderId` may end. Returns `false` (caller maps to 403) if `userId !== leaderId`. On success deletes the entry, publishes `session.ended`, returns `true`.
- `getSession(documentId): ReviewSession | null` — current snapshot.
- `evictStaleSessions(): void` — the sweep (see below).

**Leader-drop auto-end & participant pruning (`evictStaleSessions`).**
A process-wide `setInterval` (guarded on `globalThis` like the presence sweep; interval `SESSION_SWEEP_MS`, default `10_000`, `.unref()`'d) iterates active sessions and, for each, reads `presence.roster(documentId)`:
- If the **leader's** `userId` is no longer in the roster → end the session (publish `session.ended`). Leader liveness therefore rides the existing `PRESENCE_TTL_MS` (~15s) eviction; the session ends within one sweep tick after.
- Prune any non-leader participant whose `userId` is no longer in the roster → publish a single `session.updated` if the list changed.

This keeps `presence.ts` unchanged and the dependency one-way. Snappier explicit-leave (a closed tab fires the presence `leaving` beacon) still flows through the next sweep tick (≤10s).

## Events (`lib/events.ts`)

Extend the `DocEvent` union:

```ts
| { type: "session.started"; session: ReviewSession }
| { type: "session.updated"; session: ReviewSession } // join / leave / prune
| { type: "session.ended" }
```

The roadmap names `session.started`/`session.ended`; `session.updated` is added because correctness requires propagating join/leave to all viewers. The client reducer treats `started` and `updated` identically (replace the local session with the snapshot), so the set is effectively "snapshot upsert" + "teardown".

**Snapshot on connect.** `app/api/documents/[id]/stream/route.ts` already replays the presence roster via `presence.sync`. Add: if `getSession(id)` is non-null, enqueue a `session.started` event with that snapshot right after the presence sync. A late joiner opening the document mid-session immediately sees it — no separate `session.sync` type needed.

## Route (`app/api/documents/[id]/session/route.ts`)

A single `POST`, mirroring the presence beacon route's auth shape (`requireUser()` → `isParticipant()`):

```
POST /api/documents/[id]/session   body: { action: "start" | "join" | "leave" | "end" }
```

- `requireUser()` → 401 if absent.
- `isParticipant(user.id, id)` → 404 if not (same opaque-404 pattern as presence/stream routes).
- Validate `action` against the four-value set → 400 on anything else.
- Resolve display name the same way the presence route does: `(user.name?.trim()) || user.email || "Someone"`.
- Dispatch:
  - `start` → `startSession`; `null` result (already active) → **409**; else `200 { session }`.
  - `join` → `joinSession`; `null` (no active session) → **409**; else `200 { session }`.
  - `leave` → `leaveSession`; `204`.
  - `end` → `endSession`; `false` (not leader) → **403**; else `204`.

No new env vars beyond `SESSION_SWEEP_MS`. The `action` enum lives in `lib/enums.ts` per the repo convention.

## Client

**`lib/session-client.ts`** — pure, no React, unit-tested (mirrors `lib/presence-client.ts`):
- `applySessionEvent(session: ReviewSession | null, event: DocEvent): ReviewSession | null`
  `session.started` / `session.updated` → `event.session`; `session.ended` → `null`; default → unchanged.
- `isLeader(session, userId): boolean`
- `isInSession(session, userId): boolean` (participant predicate)
- `canStart(session): boolean` (= `session === null`)

**`components/SessionBanner.tsx`** — rendered in the document header beside `PresenceRoster`. Four states, each with stable test hooks:

| State | UI | Hooks |
| --- | --- | --- |
| No active session | "Start session" button | `start-session` |
| Active, viewer not joined | "{leaderName} is leading a review session · {N} in session" + "Join" | `session-banner`, `session-leader-name`, `session-participant-count`, `join-session` |
| Active, joined (non-leader) | "In session led by {leaderName} · {N} participants" + "Leave" | `session-banner`, `leave-session` |
| Active, you are leader | "You're leading · {N} participants" + "End session" | `session-banner`, `end-session` |

Each button POSTs the corresponding `action` to the session route. Buttons disable while their request is in flight.

**`components/DocumentView.tsx`** changes:
- New `session` state: `useState<ReviewSession | null>(null)` (no active session on mount; the connect snapshot supplies any in-progress one).
- Extend the existing `EventSource` `switch` (around `:402`) with `session.started` / `session.updated` / `session.ended` → `setSession((s) => applySessionEvent(s, e))`.
- A `postSessionAction(action)` helper (`fetch` POST, mirrors `sendPresence`) wired to the banner callbacks.
- Render `<SessionBanner session={session} currentUserId={currentUserId} onAction={postSessionAction} />` in the header row.
- No new `EventSource` — session events arrive on the existing document stream. The "exactly 2 EventSources" invariant is preserved and re-asserted in e2e.

## Testing

**Unit (vitest):**
- `lib/review-session.test.ts`: start creates session with leader auto-joined + emits `session.started`; second start returns `null` (one-at-a-time); join appends + emits `session.updated`; join is idempotent; non-leader `leaveSession` removes + emits update; leader `leaveSession` ends; `endSession` by non-leader returns `false` + no event; by leader deletes + emits `session.ended`; `evictStaleSessions` ends a session whose leader is absent from an injected roster and prunes dropped participants. Spy on `publish` (or subscribe) to assert events.
- `lib/session-client.test.ts`: `applySessionEvent` for started/updated/ended/unrelated; `isLeader` / `isInSession` / `canStart`.
- `app/api/documents/[id]/session/route.test.ts`: 401 unauthenticated; 404 non-participant; 400 bad action; 409 start-while-active and join-without-session; 403 end-by-non-leader; happy paths return the snapshot.

**E2E (`tests/e2e/sessions.spec.ts`, two browser contexts):**
- A and B open the same document; A clicks "Start session" → both see the banner, A as leader.
- B sees "Join" → clicks it → both banners show 2 participants.
- A clicks "End session" → both banners clear.
- Assert A's tab still holds exactly **2** EventSource connections (reuse the `countEventSources` init-script helper from `presence.spec.ts`).
- Leader-drop auto-end: close A's context → B's banner clears within the TTL window (generous timeout, like the presence eviction assertion).

## Out of scope (P4)

Session persistence/history · follow-the-leader scrolling (P5) · leadership transfer on leader drop (auto-end instead) · multiple concurrent sessions per document · session-scoped chat or any new transport.

## Worktree/env notes (carried from M1–M4)

Isolated worktree at execution time · `CI=true` on pnpm script runs · free port 3000 before `pnpm test:e2e` · preserve existing `data-testid`/`aria-label` hooks · pure libs → services → thin routes → client · value-sets in `lib/enums.ts` · rebase onto `main`, don't merge.
