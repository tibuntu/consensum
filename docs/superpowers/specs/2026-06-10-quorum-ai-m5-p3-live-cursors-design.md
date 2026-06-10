# Quorum AI — M5 P3: Live Cursors (Design Spec)

> **Phase:** M5 Phase 3 of 5.
> **Milestone roadmap:** `docs/superpowers/specs/2026-06-09-quorum-ai-m5-roadmap.md`
> **Depends on:** P1 (presence registry, beacon route, SSE presence events, roster UI) and P2 (selection beacon payload + throttle) — both shipped.
> **Status:** Approved design — ready for `writing-plans`.

## Goal

While reviewing a document together, each participant sees **where the others are
pointing** — a floating pointer glyph and name label in the other user's avatar
color, tracking their mouse over the rendered document, live. Cursors piggyback on
the existing presence beacon and SSE fan-out — no new transport, no new
`EventSource`.

In review mode the document is read-only rendered markdown, so a "cursor" here
means a **mouse-pointer presence indicator** (Figma-style), not a text-editing
caret.

## Decisions made during brainstorming

1. **Coordinate model — free-floating, normalized to the doc-body box.** The
   sender encodes the pointer as `{ x, y }`, each a fraction in `[0,1]` of the
   document body's bounding box. The receiver renders the cursor at `left:x%,
   top:y%` of the same box. Zero new dependencies, no version tagging.
   - *Accepted limitation:* if two reviewers' window widths reflow the markdown to
     different heights, vertical position drifts. Acceptable for ephemeral
     awareness; text-anchored cursors were considered and deferred (overkill for
     seconds-lived state).
2. **Cadence — 10Hz, on its own throttle.** Pointer moves fire the beacon through
   a leading+trailing throttle (`NEXT_PUBLIC_PRESENCE_CURSOR_THROTTLE_MS`, default
   100ms ≈ 10Hz, inside the roadmap's ~5-10Hz cursor budget). This is **separate
   from** P2's 250ms selection throttle so the two cadences never entangle. The
   10s keep-alive heartbeat continues unchanged.
3. **Idle cursors persist.** When the mouse stops but the user stays, the cursor
   remains at its last position (the heartbeat re-sends the current ref). It
   clears on `mouseleave` of the doc body or on TTL eviction — no separate idle
   fade.
4. **Rendering — React overlay layer (Approach A).** A `pointer-events-none`
   absolutely-positioned overlay, child of the doc-body container, driven by
   `roster` state. Unlike P2 selections (which must mutate the rendered DOM to
   wrap text at offsets), a cursor floats on top and interleaves with nothing — so
   a normal React overlay is cleaner, keeps the memoized `RenderedMarkdown`
   subtree untouched, and is far easier to test than direct DOM mutation.

## Non-goals (deferred)

- Session scoping, leader/follower semantics (P4/P5).
- Follow-the-leader scroll (P5).
- Text-editing carets (the document is read-only in review mode).
- Any persistence of cursors.
- Re-anchoring cursors across reflow/versions (the normalized model's vertical
  drift is the accepted tradeoff).

## Hard constraints (carried from the M5 roadmap)

1. No third `EventSource` — cursors ride the existing beacon POST and
   `/api/documents/[id]/stream` SSE.
2. Ephemeral, in-memory, single-instance, behind the `lib/presence.ts` interface.
3. Zero new dependencies, single Next process.
4. Intervals env-tunable; preserve existing `data-testid`/`aria-label` hooks.

## Data shapes (`lib/events.ts`)

```ts
export interface PresenceCursor {
  x: number; // 0..1 fraction of the doc-body box width
  y: number; // 0..1 fraction of the doc-body box height
}

export interface PresenceEntry {
  userId: string;
  name: string;
  lastSeen: number;
  selection?: PresenceSelection; // P2
  cursor?: PresenceCursor;       // NEW — absent when the pointer is outside the doc body
}
```

**No new `DocEvent` types.** `presence.updated` already carries the full entry and
`presence.sync` the full roster, so cursors fan out through the existing P1/P2
events unchanged. No version tagging — coordinates are not measured against
markdown text.

## Registry (`lib/presence.ts`)

`heartbeat(documentId, user, selection?, cursor?)` — a 4th positional argument,
consistent with how P2 added `selection`. Same **full-truth** semantics every
heartbeat already uses: an object sets `entry.cursor`, `null`/`undefined` clears
it (the client owns its cursor state, so there is no server-side merge ambiguity).
`leave`/`roster`/TTL sweep unchanged.

## Beacon contract (`app/api/documents/[id]/presence/route.ts`)

Body becomes:

```ts
{
  leaving?: boolean;
  selection?: { start: number; end: number; versionNumber: number } | null; // P2
  cursor?: { x: number; y: number } | null;                                 // NEW
}
```

- `leaving: true` → `leave()` (unchanged).
- New `parseCursor`, mirroring P2's `parseSelection`: `null`/absent → no cursor;
  otherwise `x` and `y` must both be **finite numbers in `[0,1]`** → else
  **400** with no presence side effect. (`sendBeacon` ignores responses; the 400
  exists for tests and API hygiene.)
- Valid → `heartbeat(id, { userId, name }, selection, cursor)` → 204.
- Identity stays server-derived from `requireUser()`; participant check unchanged.

## Client send path (`components/DocumentView.tsx`)

- A `cursorRef: { current: PresenceCursor | null }` holds the user's current
  pointer position.
- A `mousemove` listener **on the doc-body container** computes, from the
  container's `getBoundingClientRect()`:
  `x = clamp01((clientX − rect.left) / rect.width)`,
  `y = clamp01((clientY − rect.top) / rect.height)`, updates the ref, and queues a
  send through a **separate cursor throttle**
  (`NEXT_PUBLIC_PRESENCE_CURSOR_THROTTLE_MS`, default 100). The trailing edge
  guarantees the final position is always sent.
- A `mouseleave` listener sets `cursorRef.current = null` and sends **only on the
  transition** to "no cursor" (same guard pattern as P2's `clearShared`, so it
  doesn't burn redundant POSTs).
- `sendPresence()` now posts `{ selection: selectionRef.current, cursor:
  cursorRef.current }`. Mount, the 10s heartbeat, the selection throttle, and the
  cursor throttle all funnel through this single POST — each send states the full
  truth of both refs.
- Cursor tracking is **review-mode only**; the listeners are torn down in edit
  mode (the cursor clears, consistent with P2 selections).
- The `pagehide`/unmount leave beacon is unchanged.

## Render path

| Unit | File | Responsibility |
|---|---|---|
| Cursor filter | `lib/presence-client.ts` *(extend)* | Pure `remoteCursors(roster, selfId)` → `{ userId, name, x, y }[]`, dropping self and entries without a cursor. No version filter (coordinates are not version-bound). Node-unit-testable. |
| Color | `lib/presence-roster.ts` *(reuse)* | `colorFor(userId)` — the **solid** avatar color, so a cursor label matches that user's avatar and P2 selection tint. |
| Overlay | `components/PresenceCursors.tsx` *(new)* | `pointer-events-none absolute inset-0` layer rendering one floating pointer glyph + name pill per remote cursor at `left:x%, top:y%`, colored via `colorFor`. Hooks: `data-presence-cursor-user-id`, `data-user-name`. |
| Driver | `components/DocumentView.tsx` *(extend)* | Doc-body div gains `relative`; renders `<PresenceCursors cursors={remoteCursors(roster, currentUserId)} />` as a child overlay in review mode only. |

The overlay is React-rendered from `roster` state (not direct DOM mutation),
because it floats on top and never interleaves with the markdown text nodes — so
the memoized `RenderedMarkdown` subtree is never reconciled, and the P2/annotation
DOM layers are untouched.

## Error handling & edge cases

- **Idle (mouse stops, user stays):** cursor persists at its last position (the
  10s heartbeat re-sends the ref); clears on `mouseleave` or TTL eviction.
- **Departure:** `presence.left` (beacon or TTL eviction) shrinks the roster → the
  overlay re-renders without that user's cursor.
- **Self:** never rendered as a remote cursor.
- **Multiple tabs, one user:** one registry entry → last-writer-wins cursor
  (consistent with the P1 keyed-by-userId model).
- **Reflow drift:** the accepted limitation of the normalized model — the cursor's
  horizontal position is faithful; vertical position drifts when reviewers' widths
  reflow the markdown differently.
- **Coexistence:** the cursor overlay, P2 selection marks, and annotation
  highlights are independent layers; none clears another.
- **Malformed beacon:** 400, no side effect. Beacon `fetch` failures swallowed;
  the next throttle tick or heartbeat retries.
- **Edit mode:** cursor tracking torn down and the overlay not rendered; resumes
  on return to review mode.

## Testing

**Unit (Vitest, node env — pure helpers and the route only, like P1/P2):**
- `lib/presence.ts`: `heartbeat` with a cursor sets it; with `null`/absent clears
  it; cursor and selection coexist on one entry.
- Presence route: cursor validation matrix — valid cursor → 204 + stored; `x`/`y`
  out of `[0,1]`, non-finite (NaN/Infinity), non-number, or a missing field → 400,
  registry untouched. Existing selection-validation tests keep passing.
- `remoteCursors`: drops self and cursor-less entries; passes matching ones with
  name/coords intact.

**E2E (Playwright, two logged-in contexts on one document, new
`tests/e2e/cursors.spec.ts` mirroring the `presence.spec.ts`/`selections.spec.ts`
setup):**
- B moves the mouse over the doc body → A sees `[data-presence-cursor-user-id]`
  whose `data-user-name` contains "Grace", positioned within the doc body.
- B moves the pointer out of the doc body (`mouseleave`) → the cursor disappears
  from A's view.
- A cursor and a P2 selection from the same user coexist on A's view without
  clearing each other.
- Existing P1/P2 assertions (roster, selections, the **2-EventSource cap**) keep
  passing.

**Gates before PR:** `pnpm test:unit`, `pnpm test:e2e`, `pnpm lint` all green.

## File summary

| Action | Path |
|---|---|
| Extend | `lib/events.ts` (`PresenceCursor`, `PresenceEntry.cursor`) |
| Extend | `lib/presence.ts` (`heartbeat` 4th arg, store/clear cursor) |
| Extend | `app/api/documents/[id]/presence/route.ts` (`parseCursor` + validate) |
| Extend | `lib/presence-client.ts` (`remoteCursors`) |
| New | `components/PresenceCursors.tsx` (overlay layer) |
| Extend | `components/DocumentView.tsx` (cursor ref + mousemove/mouseleave send; `relative` doc body; render overlay) |
| Tests | `tests/unit/` additions; `tests/e2e/cursors.spec.ts` *(new)* |
