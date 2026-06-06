# M2/P2 — Email Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver transactional email for document activity (comment/review/version) to participants who haven't opted out, riding the existing `notifyParticipants` fan-out.

**Architecture:** A pure transport layer (`lib/email.ts`, nodemailer, env-gated/no-op when unconfigured), pure HTML/text templates (`lib/email-templates.ts`), and an in-memory per-(user,doc) debounce buffer (`lib/email-digest.ts`) that coalesces a burst into one email. `notifyParticipants` gains a second sink that enqueues email events for opted-in recipients. A single user on/off preference (`User.emailNotifications`, default ON) is managed from a new settings page.

**Tech Stack:** Next.js 16 App Router, Prisma 7 + SQLite, nodemailer, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-06-quorum-ai-m2-p2-email-design.md`

**Execution notes:**
- Prefix script/install commands with `CI=true` (pnpm v11 quirk in this repo).
- After applying the migration: `CI=true pnpm prisma migrate deploy && CI=true pnpm prisma generate`, then restart the dev server (Prisma client is gitignored, DB is per-checkout — see the `quorum-prisma-after-pull` note).
- Rebase the feature branch onto `main`; do not merge `main` in.
- No `Co-Authored-By` trailer on commits.

---

### Task 1: User.emailNotifications preference (schema + migration)

**Goal:** Add a per-user email on/off flag defaulting to ON, backfilling existing users.

**Files:**
- Modify: `prisma/schema.prisma` (User model)
- Create: `prisma/migrations/<timestamp>_user_email_notifications/migration.sql`
- Test: `tests/unit/schema.test.ts` (extend)

**Acceptance Criteria:**
- [ ] `User.emailNotifications` exists as `Boolean @default(true)`.
- [ ] Migration backfills existing rows to `true`.
- [ ] `prisma generate` succeeds and the field is queryable.

**Verify:** `CI=true pnpm test:unit tests/unit/schema.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Add the field to the User model**

In `prisma/schema.prisma`, inside `model User { ... }`, add after `role`:

```prisma
  emailNotifications Boolean @default(true)
```

- [ ] **Step 2: Create the migration**

Run:

```bash
CI=true pnpm prisma migrate dev --name user_email_notifications --create-only
```

Then ensure the generated `migration.sql` contains a backfill so existing rows are explicitly true (SQLite adds the column with the default, but make intent explicit):

```sql
-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailNotifications" BOOLEAN NOT NULL DEFAULT true;
UPDATE "User" SET "emailNotifications" = true;
```

- [ ] **Step 3: Apply + generate**

Run:

```bash
CI=true pnpm prisma migrate deploy && CI=true pnpm prisma generate
```

- [ ] **Step 4: Extend the schema test**

In `tests/unit/schema.test.ts`, add:

```ts
it("User has emailNotifications defaulting to true", async () => {
  const u = await prisma.user.create({
    data: { id: crypto.randomUUID(), name: "Pref", email: `pref-${crypto.randomUUID()}@e.com`, emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
  });
  expect(u.emailNotifications).toBe(true);
});
```

- [ ] **Step 5: Run + commit**

```bash
CI=true pnpm test:unit tests/unit/schema.test.ts
git add prisma/schema.prisma prisma/migrations tests/unit/schema.test.ts
git commit -m "feat(email): add User.emailNotifications preference (default on)"
```

---

### Task 2: Email transport (`lib/email.ts`)

**Goal:** Env-gated nodemailer transport that no-ops when unconfigured and supports a JSON capture transport for tests.

**Files:**
- Create: `lib/email.ts`
- Modify: `package.json` (+ `nodemailer`, `@types/nodemailer`)
- Modify: `.env.example` (SMTP vars)
- Test: `tests/unit/email.test.ts`

**Acceptance Criteria:**
- [ ] `isEmailConfigured()` is true only when SMTP host + from are set (or `EMAIL_TRANSPORT=json`).
- [ ] `sendMail` no-ops (no throw) when unconfigured.
- [ ] With `EMAIL_TRANSPORT=json`, `sendMail` resolves and the message is captured.

**Verify:** `CI=true pnpm test:unit tests/unit/email.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Install nodemailer**

```bash
CI=true pnpm add nodemailer && CI=true pnpm add -D @types/nodemailer
```

- [ ] **Step 2: Write the failing test**

`tests/unit/email.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("email transport", () => {
  const saved = { ...process.env };
  beforeEach(() => { vi.resetModules?.(); });
  afterEach(() => { process.env = { ...saved }; });

  it("isEmailConfigured false when no env", async () => {
    delete process.env.SMTP_HOST; delete process.env.EMAIL_FROM; delete process.env.EMAIL_TRANSPORT;
    const { isEmailConfigured } = await import("../../lib/email");
    expect(isEmailConfigured()).toBe(false);
  });

  it("sendMail no-ops when unconfigured", async () => {
    delete process.env.SMTP_HOST; delete process.env.EMAIL_FROM; delete process.env.EMAIL_TRANSPORT;
    const { sendMail } = await import("../../lib/email");
    await expect(sendMail({ to: "a@b.c", subject: "x", html: "<p>x</p>", text: "x" })).resolves.toBeUndefined();
  });

  it("captures with json transport", async () => {
    process.env.EMAIL_TRANSPORT = "json"; process.env.EMAIL_FROM = "noreply@quorum.test";
    const mod = await import("../../lib/email");
    const info = await mod.sendMailRaw({ to: "a@b.c", subject: "Hi", html: "<p>Hi</p>", text: "Hi" });
    expect(info).toBeTruthy();
    expect(String(info.message)).toContain("Hi");
  });
});
```

(Add `import { vi } from "vitest"` at top if not auto-global.)

- [ ] **Step 2b: Run to verify it fails**

Run: `CI=true pnpm test:unit tests/unit/email.test.ts` → FAIL ("Cannot find module ../../lib/email").

- [ ] **Step 3: Implement `lib/email.ts`**

```ts
import nodemailer, { type Transporter } from "nodemailer";

export interface Mail { to: string; subject: string; html: string; text: string; }

function fromAddress(): string | undefined {
  return process.env.EMAIL_FROM;
}

export function isEmailConfigured(): boolean {
  if (process.env.EMAIL_TRANSPORT === "json") return !!fromAddress();
  return !!(process.env.SMTP_HOST && fromAddress());
}

let cached: Transporter | null = null;
function transport(): Transporter {
  if (cached) return cached;
  if (process.env.EMAIL_TRANSPORT === "json") {
    cached = nodemailer.createTransport({ jsonTransport: true });
    return cached;
  }
  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return cached;
}

/** Raw send — assumes configured. Returns nodemailer info (used by tests). */
export async function sendMailRaw(mail: Mail) {
  return transport().sendMail({ from: fromAddress(), ...mail });
}

/** Best-effort send: no-op when unconfigured, never throws. */
export async function sendMail(mail: Mail): Promise<void> {
  if (!isEmailConfigured()) return;
  try { await sendMailRaw(mail); } catch { /* best-effort */ }
}

/** Test hook: reset the cached transporter between env changes. */
export function __resetTransport() { cached = null; }
```

(Call `__resetTransport()` in the json-transport test before importing-effects if needed; since tests use dynamic import with resetModules, the cache resets naturally.)

- [ ] **Step 4: Run to verify it passes**

Run: `CI=true pnpm test:unit tests/unit/email.test.ts` → PASS

- [ ] **Step 5: Document env vars**

Append to `.env.example`:

```
# Email (optional; absence disables email notifications)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=false
EMAIL_FROM=
# EMAIL_TRANSPORT=json   # test-only capture transport
```

- [ ] **Step 6: Commit**

```bash
git add lib/email.ts package.json pnpm-lock.yaml .env.example tests/unit/email.test.ts
git commit -m "feat(email): env-gated nodemailer transport with json test seam"
```

---

### Task 3: Email templates (`lib/email-templates.ts`)

**Goal:** Pure functions that render a coalesced activity summary to `{subject, html, text}` with an absolute deep link.

**Files:**
- Create: `lib/email-templates.ts`
- Test: `tests/unit/email-templates.test.ts`

**Acceptance Criteria:**
- [ ] Subject + body include the document title and an absolute `BETTER_AUTH_URL/app/documents/<id>` link.
- [ ] Single-event and multi-event phrasing differ (e.g. "1 new comment" vs "3 new comments").
- [ ] Multi-actor phrasing collapses to "X and N other(s)".

**Verify:** `CI=true pnpm test:unit tests/unit/email-templates.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test**

`tests/unit/email-templates.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { renderActivityEmail, type ActivityEvent } from "../../lib/email-templates";

beforeEach(() => { process.env.BETTER_AUTH_URL = "https://q.example"; });

const ev = (type: ActivityEvent["type"], actorName: string): ActivityEvent => ({ type, actorName });

it("single comment, single actor", () => {
  const out = renderActivityEmail({ recipientName: "Bo", docTitle: "Plan A", docId: "doc1", events: [ev("comment", "Al")] });
  expect(out.subject).toContain("Plan A");
  expect(out.subject.toLowerCase()).toContain("comment");
  expect(out.html).toContain("https://q.example/app/documents/doc1");
  expect(out.text).toContain("https://q.example/app/documents/doc1");
});

it("multiple events and actors", () => {
  const out = renderActivityEmail({ recipientName: "Bo", docTitle: "Plan A", docId: "doc1",
    events: [ev("comment", "Al"), ev("comment", "Cy"), ev("review", "Al")] });
  expect(out.subject).toMatch(/3|activity/i);
  expect(out.text).toMatch(/Al and 1 other|2 people/i);
});
```

- [ ] **Step 2: Run to verify it fails** — `... → FAIL` (module missing).

- [ ] **Step 3: Implement `lib/email-templates.ts`**

```ts
export interface ActivityEvent { type: "comment" | "review" | "version"; actorName: string; }
export interface RenderInput { recipientName: string; docTitle: string; docId: string; events: ActivityEvent[]; }

const NOUN: Record<ActivityEvent["type"], [string, string]> = {
  comment: ["comment", "comments"],
  review: ["review", "reviews"],
  version: ["new version", "new versions"],
};

function baseUrl(): string { return (process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, ""); }

function actorsPhrase(events: ActivityEvent[]): string {
  const names = [...new Set(events.map((e) => e.actorName))];
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} and ${names.length - 1} others`;
}

function countsPhrase(events: ActivityEvent[]): string {
  const byType = new Map<ActivityEvent["type"], number>();
  for (const e of events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
  return [...byType.entries()]
    .map(([t, n]) => `${n} ${n === 1 ? NOUN[t][0] : NOUN[t][1]}`)
    .join(", ");
}

export function renderActivityEmail(input: RenderInput): { subject: string; html: string; text: string } {
  const url = `${baseUrl()}/app/documents/${input.docId}`;
  const counts = countsPhrase(input.events);
  const who = actorsPhrase(input.events);
  const subject = `${input.docTitle}: ${counts}`;
  const lead = `${who} left ${counts} on “${input.docTitle}”.`;
  const text = `Hi ${input.recipientName},\n\n${lead}\n\nReview it: ${url}\n\n— Quorum`;
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1e1b2e">
  <p>Hi ${escapeHtml(input.recipientName)},</p>
  <p>${escapeHtml(lead)}</p>
  <p><a href="${url}" style="display:inline-block;padding:10px 16px;background:#6d28d9;color:#fff;border-radius:8px;text-decoration:none">Open in Quorum</a></p>
  <p style="color:#6b6780;font-size:12px">You receive these because you're a participant on this document. Turn them off in Settings → Notifications.</p>
  </body></html>`;
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
```

- [ ] **Step 4: Run to verify it passes** — `... → PASS`.

- [ ] **Step 5: Commit**

```bash
git add lib/email-templates.ts tests/unit/email-templates.test.ts
git commit -m "feat(email): activity summary templates (html + text)"
```

---

### Task 4: Email digest buffer (`lib/email-digest.ts`)

**Goal:** Coalesce a burst of events for one (user, doc) into a single email after a short debounce; no-op when SMTP unconfigured.

**Files:**
- Create: `lib/email-digest.ts`
- Test: `tests/unit/email-digest.test.ts`

**Acceptance Criteria:**
- [ ] N events on one (user, doc) within the window → exactly one `sendMail` call.
- [ ] Events for different (user, doc) keys produce separate sends.
- [ ] `enqueueEmailEvent` is a no-op when `isEmailConfigured()` is false (nothing buffered, no send).

**Verify:** `CI=true pnpm test:unit tests/unit/email-digest.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test** (fake timers + mocked deps)

`tests/unit/email-digest.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../lib/email", () => ({
  isEmailConfigured: vi.fn(() => true),
  sendMail: vi.fn(async () => {}),
}));
vi.mock("../../lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => ({ name: "Bo", email: "bo@e.com" })) },
    document: { findUnique: vi.fn(async () => ({ title: "Plan A" })) },
  },
}));

describe("email digest", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); process.env.EMAIL_DEBOUNCE_MS = "50"; });
  afterEach(() => { vi.useRealTimers(); });

  it("coalesces a burst into one email", async () => {
    const { enqueueEmailEvent } = await import("../../lib/email-digest");
    const email = await import("../../lib/email");
    enqueueEmailEvent("u1", "doc1", "comment", "Al");
    enqueueEmailEvent("u1", "doc1", "comment", "Cy");
    enqueueEmailEvent("u1", "doc1", "review", "Al");
    await vi.advanceTimersByTimeAsync(60);
    expect(email.sendMail).toHaveBeenCalledTimes(1);
  });

  it("no-op when unconfigured", async () => {
    const email = await import("../../lib/email");
    (email.isEmailConfigured as any).mockReturnValueOnce(false);
    const { enqueueEmailEvent } = await import("../../lib/email-digest");
    enqueueEmailEvent("u2", "doc2", "comment", "Al");
    await vi.advanceTimersByTimeAsync(60);
    expect(email.sendMail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module missing → FAIL.

- [ ] **Step 3: Implement `lib/email-digest.ts`**

```ts
import { prisma } from "./db";
import { isEmailConfigured, sendMail } from "./email";
import { renderActivityEmail, type ActivityEvent } from "./email-templates";

type Key = string; // `${userId}:${documentId}`
interface Buffer { events: ActivityEvent[]; timer: ReturnType<typeof setTimeout>; userId: string; documentId: string; }

const buffers = new Map<Key, Buffer>();

function windowMs(): number { return Number(process.env.EMAIL_DEBOUNCE_MS ?? 45000); }

export function enqueueEmailEvent(userId: string, documentId: string, type: ActivityEvent["type"], actorName: string): void {
  if (!isEmailConfigured()) return;
  const key = `${userId}:${documentId}`;
  const existing = buffers.get(key);
  if (existing) {
    existing.events.push({ type, actorName });
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => void flush(key), windowMs());
    return;
  }
  const buf: Buffer = { events: [{ type, actorName }], userId, documentId, timer: setTimeout(() => void flush(key), windowMs()) };
  buffers.set(key, buf);
}

async function flush(key: Key): Promise<void> {
  const buf = buffers.get(key);
  if (!buf) return;
  buffers.delete(key);
  try {
    const [user, doc] = await Promise.all([
      prisma.user.findUnique({ where: { id: buf.userId }, select: { name: true, email: true } }),
      prisma.document.findUnique({ where: { id: buf.documentId }, select: { title: true } }),
    ]);
    if (!user?.email || !doc) return;
    const mail = renderActivityEmail({ recipientName: user.name, docTitle: doc.title, docId: buf.documentId, events: buf.events });
    await sendMail({ to: user.email, ...mail });
  } catch { /* best-effort */ }
}
```

- [ ] **Step 4: Run to verify it passes** — `... → PASS`.

- [ ] **Step 5: Commit**

```bash
git add lib/email-digest.ts tests/unit/email-digest.test.ts
git commit -m "feat(email): per-(user,doc) debounce buffer coalescing events"
```

---

### Task 5: Wire email into `notifyParticipants`

**Goal:** After creating in-app notifications, enqueue an email event for each opted-in recipient on email-eligible event types (comment/review/version); `resolve` stays in-app only.

**Files:**
- Modify: `lib/notifications.ts`
- Test: `tests/unit/notifications.test.ts` (extend)

**Acceptance Criteria:**
- [ ] Recipients with `emailNotifications=false` are not enqueued.
- [ ] The actor is never enqueued.
- [ ] `type="resolve"` produces no email enqueue.
- [ ] In-app `Notification` creation behavior is unchanged.

**Verify:** `CI=true pnpm test:unit tests/unit/notifications.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Read current `notifyParticipants`**

It currently: finds `DocumentParticipant` rows for the doc, excludes `actorId`, `createMany` Notifications.

- [ ] **Step 2: Write the failing test**

In `tests/unit/notifications.test.ts`, add a block that spies on the digest:

```ts
import { vi } from "vitest";
vi.mock("../../lib/email-digest", () => ({ enqueueEmailEvent: vi.fn() }));

it("enqueues email for opted-in non-actor participants only", async () => {
  const { enqueueEmailEvent } = await import("../../lib/email-digest");
  // arrange: actor A (opted in), participant B (opted in), participant C (opted out)
  // ...create users + document + participants via prisma (follow existing test helpers in this file)...
  await notifyParticipants(docId, actorId /* A */, "comment");
  const calls = (enqueueEmailEvent as any).mock.calls.map((c: any[]) => c[0]);
  expect(calls).toContain(bId);
  expect(calls).not.toContain(cId); // opted out
  expect(calls).not.toContain(actorId); // actor excluded
});

it("does not enqueue email for resolve events", async () => {
  const { enqueueEmailEvent } = await import("../../lib/email-digest");
  (enqueueEmailEvent as any).mockClear();
  await notifyParticipants(docId, actorId, "resolve");
  expect(enqueueEmailEvent).not.toHaveBeenCalled();
});
```

(Reuse the file's existing setup helpers for creating users/documents/participants; mirror patterns already in `notifications.test.ts`.)

- [ ] **Step 3: Run to verify it fails** — assertions fail (no enqueue yet).

- [ ] **Step 4: Implement the wiring**

In `lib/notifications.ts`, update `notifyParticipants`:

```ts
import { enqueueEmailEvent } from "./email-digest";

const EMAILABLE = new Set(["comment", "review", "version"]);

export async function notifyParticipants(documentId: string, actorId: string, type: string): Promise<void> {
  const participants = await prisma.documentParticipant.findMany({
    where: { documentId },
    select: { userId: true, user: { select: { name: true, emailNotifications: true } } },
  });
  const recipients = participants.filter((p) => p.userId !== actorId);

  // In-app (unchanged behavior)
  await prisma.notification.createMany({
    data: recipients.map((p) => ({ userId: p.userId, documentId, actorId, type })),
  });

  // Email sink (best-effort, opted-in, emailable types only)
  if (EMAILABLE.has(type)) {
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
    const actorName = actor?.name ?? "Someone";
    for (const p of recipients) {
      if (p.user?.emailNotifications) {
        enqueueEmailEvent(p.userId, documentId, type as "comment" | "review" | "version", actorName);
      }
    }
  }
}
```

(If the current signature/return differs, preserve it — only add the recipient `select` fields and the email block.)

- [ ] **Step 5: Run to verify it passes** — `... → PASS`. Also run the full unit suite: `CI=true pnpm test:unit` → PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/notifications.ts tests/unit/notifications.test.ts
git commit -m "feat(email): enqueue emails from notifyParticipants for opted-in participants"
```

---

### Task 6: Settings — notifications preference UI + sub-nav

**Goal:** A settings page with the email on/off toggle, its API route, and a settings sub-nav so both Tokens and Notifications are reachable.

**Files:**
- Create: `app/app/settings/layout.tsx` (settings sub-nav)
- Create: `app/app/settings/notifications/page.tsx`
- Create: `components/NotificationSettings.tsx`
- Create: `app/api/settings/notifications/route.ts`
- Modify: `components/AppNav.tsx` (Settings link target → `/app/settings/notifications` or keep tokens; sub-nav handles the rest)
- Test: `tests/e2e/notifications-pref.spec.ts`

**Acceptance Criteria:**
- [ ] `/app/settings/notifications` renders the current preference for the session user.
- [ ] Toggling it `PATCH`es `/api/settings/notifications` and persists to `User.emailNotifications`.
- [ ] The settings sub-nav links to both Tokens and Notifications.
- [ ] API route is session-guarded (401 when unauthenticated).

**Verify:** `CI=true pnpm test:e2e tests/e2e/notifications-pref.spec.ts` → PASS

**Steps:**

- [ ] **Step 1: API route**

`app/api/settings/notifications/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth"; // use the helper already used by other API routes
import { prisma } from "@/lib/db";

export async function PATCH(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.emailNotifications !== "boolean") {
    return NextResponse.json({ error: "emailNotifications must be boolean" }, { status: 400 });
  }
  await prisma.user.update({ where: { id: user.id }, data: { emailNotifications: body.emailNotifications } });
  return NextResponse.json({ ok: true, emailNotifications: body.emailNotifications });
}
```

(Confirm the exact auth helper/import alias used by `app/api/tokens/route.ts` and match it — `requireUser` and `@/lib/...` are the patterns observed.)

- [ ] **Step 2: Client toggle component**

`components/NotificationSettings.tsx`:

```tsx
"use client";
import { useState } from "react";

export function NotificationSettings({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [saving, setSaving] = useState(false);
  async function toggle() {
    const next = !on;
    setOn(next); setSaving(true);
    await fetch("/api/settings/notifications", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ emailNotifications: next }),
    }).catch(() => setOn(!next));
    setSaving(false);
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-foreground">Notifications</h1>
      <label className="flex items-center gap-3 text-sm text-foreground">
        <input type="checkbox" data-testid="email-pref" checked={on} disabled={saving} onChange={toggle} />
        Email me about activity on my documents
      </label>
      <p className="text-sm text-muted">Emails are only sent when the server has SMTP configured.</p>
    </div>
  );
}
```

- [ ] **Step 3: Settings page (server)**

`app/app/settings/notifications/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NotificationSettings } from "@/components/NotificationSettings";

export default async function NotificationsSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { emailNotifications: true } });
  return <NotificationSettings initial={user?.emailNotifications ?? true} />;
}
```

(Match the session helper used by `app/app/settings/tokens/page.tsx`.)

- [ ] **Step 4: Settings sub-nav layout**

`app/app/settings/layout.tsx`:

```tsx
import Link from "next/link";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <nav className="mb-6 flex gap-4 text-sm" data-testid="settings-subnav">
        <Link href="/app/settings/notifications" className="text-foreground hover:text-primary">Notifications</Link>
        <Link href="/app/settings/tokens" className="text-foreground hover:text-primary">API tokens</Link>
      </nav>
      {children}
    </div>
  );
}
```

- [ ] **Step 5: Point the header Settings link at the section**

In `components/AppNav.tsx`, change the Settings entry href:

```tsx
{ href: "/app/settings/notifications", label: "Settings", testid: "settings-link" },
```

- [ ] **Step 6: E2e test**

`tests/e2e/notifications-pref.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
// reuse the repo's existing register/login helper pattern from other e2e specs

test("user can toggle email notifications and it persists", async ({ page }) => {
  // register + login (follow tests/e2e/auth.spec.ts helpers)
  await page.goto("/app/settings/notifications");
  const box = page.getByTestId("email-pref");
  await expect(box).toBeChecked(); // default on
  await box.click();
  await expect(box).not.toBeChecked();
  await page.reload();
  await expect(page.getByTestId("email-pref")).not.toBeChecked();
});
```

- [ ] **Step 7: Run + commit**

```bash
CI=true pnpm test:e2e tests/e2e/notifications-pref.spec.ts
git add app/app/settings components/NotificationSettings.tsx app/api/settings components/AppNav.tsx tests/e2e/notifications-pref.spec.ts
git commit -m "feat(email): notification preference settings page + settings sub-nav"
```

---

## Final verification

- [ ] `CI=true pnpm lint` → clean
- [ ] `CI=true pnpm test:unit` → all PASS
- [ ] `CI=true pnpm test:e2e` → all PASS
- [ ] Manual smoke with `EMAIL_TRANSPORT=json` + `EMAIL_FROM=...` + tiny `EMAIL_DEBOUNCE_MS=200`: as user B, comment on user A's doc; confirm a JSON-transport email is logged to A, and that toggling A's preference off suppresses it.
