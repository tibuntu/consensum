# M6 · P2 — Granular Per-Type Notification Preferences — Design

> **Milestone:** M6 (Review Depth & Polish) · **Phase:** P2 · **Date:** 2026-06-10
> **Roadmap:** `docs/superpowers/specs/2026-06-10-quorum-ai-m6-roadmap.md`
> **Follows:** M6/P1 (UI polish, shipped on `main`).

## Context

Quorum AI today has two **global** notification booleans on `User`: `emailNotifications` (default true) and
`desktopNotifications` (default false). The system emits four notification **types** — `comment`, `review`,
`version`, `resolve` — over three **channels**:
- **in-app inbox:** a `Notification` row is always created for all four types in `notifyParticipants()`
  (`lib/notifications.ts:7-44`); surfaced live via SSE → `NotificationProvider`.
- **email digest:** best-effort, coalesced, gated by `User.emailNotifications`; only `comment`/`review`/`version`
  are emailable (`EMAILABLE` set, `lib/notifications.ts:5`; `enqueueEmailEvent`, `lib/email-digest.ts`). `resolve`
  is never emailed.
- **desktop / Web Notifications:** client-side in `components/NotificationProvider.tsx:48-59`, gated by
  `User.desktopNotifications` (passed from `app/app/layout.tsx:36`), fires when the tab is hidden.

P2 replaces the two coarse globals with **per-(type × channel)** control.

## Goal

Give users a per-type matrix of notification toggles across all three channels, replacing the two global
booleans, while **preserving today's behavior by default** for existing and new users.

## The matrix (decided)

```
            in-app   email   desktop
comment      ✓        ✓        ✓
review       ✓        ✓        ✓
version      ✓        ✓        ✓
resolve      ✓        —        ✓      (resolve is never emailed — no email cell)
```

- **Full 3-channel matrix:** in-app is now per-type muteable too. Muting in-app for a (user,type) means **no
  `Notification` row is created** — so it's naturally absent from the inbox list and unread counts; no read-time
  filtering is required.
- **`resolve` stays non-emailable** — its email cell is absent/disabled. 11 live toggles total.

## Architecture (schema option A — JSON column + pure helper)

We always read a user's *entire* preference set and decide in app code (dispatch already loads each recipient's
`User` row); we never query *by* a preference in SQL. So preferences live in a **JSON column on `User`**, not a
side table — no join, no lazy-row defaulting.

### Data model
- **`prisma/schema.prisma` `User`:** add `notificationPrefs Json?` (nullable; `null`/missing keys → defaults).
  **Remove** `emailNotifications` and `desktopNotifications` (single source of truth).
- **Stored shape** (canonical, but any subset is tolerated and defaulted by the helper):
  ```jsonc
  {
    "comment": { "inApp": true,  "email": true,  "desktop": false },
    "review":  { "inApp": true,  "email": true,  "desktop": false },
    "version": { "inApp": true,  "email": true,  "desktop": false },
    "resolve": { "inApp": true,                  "desktop": false }   // no email key
  }
  ```

### `lib/notification-prefs.ts` (new — pure, the only place that knows the matrix)
- Imports value-sets from `lib/enums.ts`: `NOTIFICATION_TYPES = ["comment","review","version","resolve"]`,
  `NOTIFICATION_CHANNELS = ["inApp","email","desktop"]`, and the allowed (type→channels) map (resolve excludes
  email).
- `DEFAULT_PREFS`: inApp all `true`; email comment/review/version `true`; desktop all `false`.
- `parsePrefs(json: unknown): NotificationPrefs` — merges stored JSON over `DEFAULT_PREFS`, drops unknown
  type/channel keys, coerces non-booleans to the default. Never throws.
- `isEnabled(prefs, type, channel): boolean` — the single decision function used by dispatch + client.
- `isValidCell(type, channel): boolean` — true only for cells that exist (rejects `resolve+email`).
- `applyPatch(prefs, type, channel, enabled): NotificationPrefs` — returns a new prefs object with one cell set
  (validates the cell first).
- All functions pure + unit-tested.

### Migration (data-preserving, then drop)
A Prisma migration that:
1. adds `notificationPrefs`,
2. backfills every existing user: `email.{comment,review,version} = old emailNotifications`,
   `desktop.{all} = old desktopNotifications`, `inApp.{all} = true`,
3. drops `emailNotifications` and `desktopNotifications`.
(SQLite drops via table-rebuild — Prisma handles this in the generated migration. Verify the backfill SQL runs
before the column drop.)

## Server dispatch — `lib/notifications.ts notifyParticipants(documentId, actorId, type)`
- Change the participant query to select each recipient's `notificationPrefs` (instead of `emailNotifications`).
- For each recipient, `const prefs = parsePrefs(user.notificationPrefs)`:
  - **in-app:** create the `Notification` row + `publish(...notification.created)` **only if**
    `isEnabled(prefs, type, "inApp")`.
  - **email:** enqueue **only if** `EMAILABLE.has(type) && isEnabled(prefs, type, "email")` (resolve short-circuits
    via `EMAILABLE`).
- Desktop is decided client-side (below); the server still publishes the in-app event (when in-app is on), which
  is what the client listens to.

> Note: if in-app is OFF for a type, no event is published for that recipient, so desktop can't fire for it
> either — acceptable and intuitive (desktop is a push layer over the inbox event). The matrix UI will reflect
> this coupling in copy if needed, but no special-casing in code.

## Client desktop — `components/NotificationProvider.tsx` + `lib/notification-client.ts`
- Replace the `desktopEnabled: boolean` prop with `desktopPrefs: Record<NotificationType, boolean>` (the per-type
  desktop column), sourced in `app/app/layout.tsx` from `parsePrefs(user.notificationPrefs)`.
- `shouldFireOsNotification(...)` gains the per-type desktop lookup: fire only if
  `desktopPrefs[e.notification.type]` is true (plus the existing permission/visibility/seen guards).

## API — `PATCH /api/settings/notifications`
- New body: `{ type: NotificationType, channel: NotificationChannel, enabled: boolean }` (per-cell, matching the
  existing per-toggle save pattern).
- Validate with `isValidCell(type, channel)` + `typeof enabled === "boolean"`; **400** on unknown type/channel,
  non-boolean, or the `resolve+email` cell.
- Load the user's prefs, `applyPatch(...)`, persist `notificationPrefs`, return `{ ok: true, prefs }`.

## UI — `components/NotificationSettings.tsx` + `app/app/settings/notifications/page.tsx`
- Page loads `parsePrefs(user.notificationPrefs)` and passes the full prefs to `NotificationSettings`.
- Replace the two checkboxes with a **matrix**: rows = the four types (with human labels + short descriptions),
  columns = In-app / Email / Desktop. The `resolve` × Email cell is rendered disabled/absent.
- Each toggle PATCHes its cell (optimistic, revert on failure — same pattern as today).
- Enabling **any** desktop cell, when `Notification.permission !== "granted"`, requests permission first; if
  denied, leave that cell off (same guard the current single desktop toggle uses).
- **Test hooks:** stable per-cell testids `pref-<type>-<channel>` (e.g. `pref-comment-email`,
  `pref-resolve-desktop`). Keep the "Emails are only sent when the server has SMTP configured" helper copy.

## Out of scope
New notification *types*; per-document preference granularity; webhook event filtering (already per-event via
`Webhook.events`); changing the email coalescing/digest mechanics.

## Verification
- **Unit (`tests/unit`):**
  - `lib/notification-prefs.ts`: `DEFAULT_PREFS` preserve current behavior; `parsePrefs` merges/defaults/strips
    unknowns and never throws; `isEnabled`; `isValidCell` rejects `resolve+email`; `applyPatch` validates + is
    immutable.
  - `notifyParticipants` dispatch filtering: in-app row created only when inApp on; email enqueued only when
    emailable + email on; muting a type suppresses that type only.
- **E2E (`tests/e2e/notifications-pref.spec.ts`, rewritten for the matrix):** default states correct;
  toggling a cell persists across reload (per-cell PATCH); a representative in-app mute + email mute path.
- **Full gate:** `CI=true pnpm test:unit` (green, count ≥ current baseline + new tests), free port 3000 then
  `pnpm test:e2e` (all green — including the migrated DB), `pnpm lint` 0, `npx tsc --noEmit` 0, `pnpm build` 0/0.

## Worktree / env notes
Fresh worktree → bootstrap before tests: `CI=true pnpm install`, `.env` with 32+ char `AUTH_SECRET` + `BASE_URL`,
`prisma migrate dev` (creates the new migration) then `prisma generate`. After pulling schema changes restart
dev + `prisma migrate deploy` + `prisma generate` (client gitignored, DB per-checkout). Rebased onto local
`main`. Phase lands by fast-forwarding into local `main`; don't push unless asked.
