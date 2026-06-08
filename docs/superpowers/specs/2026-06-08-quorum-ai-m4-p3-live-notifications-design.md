# M4 · P3 — Live Notifications (design)

> Phase spec for M4 P3. Parent roadmap: `specs/2026-06-08-quorum-ai-m4-roadmap.md`.
> Make in-app notifications live: a global per-user SSE stream drives a tab-title unread count and (opt-in) native Web Notifications.

## Problem

The in-app unread count is computed once, server-side, at layout load (`app/app/layout.tsx:14` → `unreadCount()`), then passed to `AppNav`. It never updates without a reload, and nothing surfaces at the browser/OS level. A reviewer with the tab in the background misses new comments, reviews, and decisions. There is a per-document SSE bus (`lib/events.ts`) used by `DocumentView`, but no global per-user stream.

## Decisions (locked)

- **Global per-user SSE stream** (not polling) for liveness, reusing `lib/events.ts`.
- **Tab-title unread count** always updates: `document.title = "(N) Quorum AI"`, reverting to `"Quorum AI"` at zero.
- **Web Notifications API**, opt-in: a settings toggle requests permission; OS notifications fire **only when the tab is hidden** (`document.visibilityState === "hidden"`), deduped by notification id.

## Architecture overview

```
notifyParticipants() ──publish("user-<id>", {type:"notification.created", ...})──┐
markRead/markAllRead ──publish("user-<id>", {type:"notification.read"|"read.all"})┤
                                                                                  ▼
                                          GET /api/notifications/stream (SSE, per-user topic)
                                                                                  ▼
                                  <NotificationProvider> (client, mounted in app layout)
                                   ├─ owns EventSource, seeds from server initial unread
                                   ├─ context: { unread, items, markRead, markAllRead }
                                   ├─ drives document.title
                                   └─ fires Web Notification when hidden + permitted + opted-in
                                                                                  ▼
                                            AppNav (badge)   InboxList (live list)
```

## 1. Event bus — `lib/events.ts`
The bus already keys channels by an arbitrary string (currently `documentId`). Reuse it with a per-user topic `user-<userId>`. Add notification event variants to the `DocEvent` union (or a parallel type — keep one union for simplicity):

```ts
| { type: "notification.created"; notification: ClientNotification }
| { type: "notification.read"; id: string }
| { type: "notification.read.all" }
```

`ClientNotification` = the shape `listNotifications` returns for one row (id, type, documentId, document.title, actorId, read, createdAt). No bus API change — `publish(`user-${userId}`, ev)` / `subscribe(`user-${userId}`, fn)` already work.

## 2. Publish points — `lib/notifications.ts`
- In `notifyParticipants()`, after the in-app `Notification` rows are created, publish a `notification.created` to each recipient's `user-<id>` topic with the created row's client shape. (The rows are created in a batch today; either create-then-reselect to get ids, or build the client payloads from the created data.)
- In `markRead()` publish `notification.read` (id) to that user's topic; in `markAllRead()` publish `notification.read.all`. This keeps multiple open tabs and the title count consistent.

SSE remains in-memory/single-instance — consistent with the M3 decision that live/ephemeral fan-out stays in-process (durable delivery is the outbox/webhooks path, not this).

## 3. SSE route — `app/api/notifications/stream/route.ts` (new)
Mirror `app/api/documents/[id]/stream/route.ts` exactly (ReadableStream, `: connected`, 25 s heartbeat, cancel→unsubscribe), but:
- auth: `requireUser()` only (no document scope); 401 if absent.
- subscribe to `user-${user.id}`.
- same SSE headers.

## 4. Per-user preference — `User.desktopNotifications`
- Schema: add `desktopNotifications Boolean @default(false)` to `User` (`prisma/schema.prisma`), plus a migration. Default **false** (opt-in; OS notifications require an explicit gesture + browser permission anyway).
- This gates whether the provider *fires* OS notifications. The SSE stream and tab-title count are always on (no permission needed).

## 5. Settings toggle — `components/NotificationSettings.tsx` + API
- Extend `NotificationSettings` to a second checkbox "Show desktop notifications when Quorum is in the background" (`data-testid="desktop-pref"`). Toggling **on** calls `Notification.requestPermission()` first; if not `"granted"`, revert the toggle and don't persist. On success, PATCH `desktopNotifications: true`.
- `app/api/settings/notifications/route.ts`: accept either `emailNotifications` or `desktopNotifications` (boolean), update only provided fields, 400 if neither present.
- `app/app/settings/notifications/page.tsx`: select+pass both `emailNotifications` and `desktopNotifications`.

## 6. Client provider — `components/NotificationProvider.tsx` (new) + hook
A `"use client"` provider mounted in `app/app/layout.tsx`, wrapping `children` and `AppNav`. Props seeded from the server: `initialUnread`, `desktopEnabled` (the user's pref). It:
- opens `EventSource("/api/notifications/stream")` using the **same reconnect pattern** as `DocumentView` (lines 236-271): `onerror` → close + `setTimeout(connect, 2000)`; cleanup closes and clears.
- maintains `unread` (seed `initialUnread`; `+1` on `created`, `-1` on `read`, `0` on `read.all`) and an `items` list for the inbox.
- exposes context `{ unread, items, markRead, markAllRead }` where `markRead`/`markAllRead` call the existing PATCH `/api/notifications` and optimistically update (the SSE echo keeps other tabs in sync).
- **title effect:** `document.title = unread > 0 ? `(${unread}) Quorum AI` : "Quorum AI"`.
- **OS-notify effect:** on a `notification.created` event, if `desktopEnabled && Notification.permission === "granted" && document.visibilityState === "hidden"` and the id hasn't been seen, `new Notification(...)` with the document title/type; track seen ids in a ref to dedup (StrictMode double-mount + reconnect replay safety).

`AppNav` reads `unread` from context instead of (or seeded by) the prop; `InboxList` reads `items`/actions from context so it updates live. Keep existing `data-testid`/`aria-label` hooks intact.

### SSR/seed detail
`app/app/layout.tsx` (server) still computes `unreadCount` and now also selects the user's `desktopNotifications`; both are passed into `NotificationProvider` as initial values so there's no flash and no extra client fetch on mount.

## Tests
- Unit: `notifyParticipants` publishes `notification.created` to each recipient topic (subscribe a spy to `user-<id>`); `markRead`/`markAllRead` publish the read events. Existing notification tests stay green.
- Unit: reducer for unread count (created/read/read.all transitions) — extract the count logic to a pure function to test without a DOM.
- Route: `/api/notifications/stream` → 401 unauthenticated; authenticated returns an `text/event-stream` response and emits `: connected`.
- Component/e2e (light): with two browser contexts, an action by user A creates a notification that appears in user B's badge live; tab-title shows `(1) …`. OS-notification firing is hard to assert in e2e — cover the decision logic (hidden + permitted + opted-in + unseen) via the extracted pure predicate instead.

## Out of scope
Device push when no tab is open (that's webhooks/CI territory) · per-type notification preferences (single global desktop toggle only) · favicon badge · notification sound · WebSocket transport · multi-instance fan-out (SSE stays in-process). All → M5+.

## Files touched
- `lib/events.ts` (notification event variants)
- `lib/notifications.ts` (publish on create / read / read-all)
- `app/api/notifications/stream/route.ts` (new SSE route)
- `prisma/schema.prisma` + migration (`User.desktopNotifications`)
- `app/api/settings/notifications/route.ts` (accept desktop pref)
- `components/NotificationSettings.tsx`, `app/app/settings/notifications/page.tsx` (toggle)
- `components/NotificationProvider.tsx` (new) + small hook; `app/app/layout.tsx` (mount + seed)
- `components/AppNav.tsx`, `components/InboxList.tsx` (consume context, live)
- tests per above.
