# M3 / P1 — Foundations & Durable Outbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable SQLite-backed `OutboxJob` queue + a single in-process polling worker (retry/backoff/dead-letter), re-home the email digest onto it, and land the cheap enablers (FK indexes + nullable `Annotation.severity`/`category`).

**Architecture:** A new `lib/outbox.ts` owns the engine — a pure `computeBackoffMs`, an `enqueue`, a typed handler registry, and a `tick()` that leases due `PENDING` rows to `DELIVERING`, runs the handler, then marks `DONE` / re-schedules with backoff / `DEAD`. `startOutboxWorker()` (idempotent, `globalThis`-guarded like `lib/events.ts`) drives `tick()` on an interval and is launched once from a root `instrumentation.ts`. `lib/email-digest.ts` keeps its in-memory 45 s coalescer but, on window close, enqueues one `email.digest` job instead of sending inline; the registered handler does the render+send. Tests drive `tick()` directly (auto-start is off under `NODE_ENV==="test"`).

**Tech Stack:** Next.js 16, Prisma (`prisma-client` generator → `@/generated/prisma`) on better-sqlite3, Vitest (node env, sequential), nodemailer.

**Spec:** `docs/superpowers/specs/2026-06-06-quorum-ai-m3-p1-foundations-outbox-design.md`

**Env / execution notes:** pnpm v11 needs `CI=true` on script runs; migration is `CI=true pnpm db:migrate --name <name>` (regenerates the gitignored client); free port 3000 before `pnpm test:e2e`; new value-sets go in `lib/enums.ts`; rebase onto `main`, don't merge. Branch: `m3-p1-foundations-outbox`.

---

### Task 1: Data-model foundations (schema, migration, enums)

**Goal:** Add the `OutboxJob` table, the deferred FK indexes, nullable `Annotation.severity`/`category`, and the `SEVERITIES` value-set; run the additive migration.

**Files:**
- Modify: `prisma/schema.prisma` (add `OutboxJob` model; add `@@index` on `Annotation.authorId`, `Comment.authorId`, `Review.reviewerId`, `DocumentVersion.createdById`; add `severity`/`category` to `Annotation`)
- Modify: `lib/enums.ts` (add `SEVERITIES`)
- Modify: `tests/unit/schema.test.ts` (round-trip assertions)
- Migration dir auto-created by `prisma migrate dev`

**Acceptance Criteria:**
- [ ] `OutboxJob` round-trips with defaults `status="PENDING"`, `attempts=0`, `maxAttempts=6`, and a `nextAttemptAt`.
- [ ] `Annotation` accepts `severity` + `category` and they default to `null` when omitted.
- [ ] FK indexes exist on the four columns (present in the generated migration SQL).
- [ ] `SEVERITIES` exported from `lib/enums.ts` as `["BLOCKER","MAJOR","MINOR","NIT"]`.
- [ ] Migration applied; `pnpm test:unit` green.

**Verify:** `CI=true pnpm test:unit tests/unit/schema.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Add the `SEVERITIES` value-set to `lib/enums.ts`** (append after `REVIEW_VERDICTS`):

```ts
export const SEVERITIES = ["BLOCKER", "MAJOR", "MINOR", "NIT"] as const;
export type Severity = (typeof SEVERITIES)[number];
```

- [ ] **Step 2: Add the `OutboxJob` model to `prisma/schema.prisma`** (append at end of file):

```prisma
model OutboxJob {
  id            String   @id @default(cuid())
  type          String                       // "email.digest" | "webhook.deliver"
  payload       String                       // JSON string (SQLite has no native JSON)
  status        String   @default("PENDING") // PENDING | DELIVERING | DONE | DEAD
  attempts      Int      @default(0)
  maxAttempts   Int      @default(6)
  nextAttemptAt DateTime @default(now())
  lastError     String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([status, nextAttemptAt])
}
```

- [ ] **Step 3: Add the deferred FK indexes.** In `prisma/schema.prisma` add one `@@index` line inside each model:
  - `Annotation` (after existing `@@index([createdOnVersionId])`): `@@index([authorId])`
  - `Comment` (after `@@index([annotationId])`): `@@index([authorId])`
  - `Review` (after `@@index([onVersionId])`): `@@index([reviewerId])`
  - `DocumentVersion` (after `@@index([documentId])`): `@@index([createdById])`

- [ ] **Step 4: Add `severity` + `category` to the `Annotation` model** (place after `threadStatus`):

```prisma
  severity           String?  // BLOCKER | MAJOR | MINOR | NIT (nullable; see lib/enums.ts SEVERITIES)
  category           String?  // free-form short tag, e.g. "security", "scope", "naming"
```

- [ ] **Step 5: Run the migration** (regenerates the gitignored client):

```bash
CI=true pnpm db:migrate --name outbox_and_annotation_fields
```
Expected: a new `prisma/migrations/<ts>_outbox_and_annotation_fields/` with `CREATE TABLE "OutboxJob"`, `CREATE INDEX` lines for the four FKs + `OutboxJob(status, nextAttemptAt)`, and `ALTER TABLE "Annotation" ADD COLUMN "severity"/"category"`.

- [ ] **Step 6: Add schema round-trip assertions to `tests/unit/schema.test.ts`** (new `it` blocks inside the existing `describe`):

```ts
  it("OutboxJob defaults to PENDING with attempts=0, maxAttempts=6", async () => {
    const job = await prisma.outboxJob.create({
      data: { type: "email.digest", payload: JSON.stringify({ a: 1 }) },
    });
    expect(job.status).toBe("PENDING");
    expect(job.attempts).toBe(0);
    expect(job.maxAttempts).toBe(6);
    expect(job.nextAttemptAt).toBeInstanceOf(Date);
    await prisma.outboxJob.delete({ where: { id: job.id } });
  });

  it("Annotation severity/category default to null and round-trip", async () => {
    const now = new Date();
    const user = await prisma.user.create({
      data: { id: `sev-${Date.now()}`, name: "Sev", email: `sev-${Date.now()}@e.com`, emailVerified: false, createdAt: now, updatedAt: now },
    });
    const doc = await prisma.document.create({ data: { title: "Sev Doc", ownerId: user.id } });
    const v1 = await prisma.documentVersion.create({
      data: { documentId: doc.id, versionNumber: 1, markdown: "# Hi", contentHash: "h", createdById: user.id },
    });
    const plain = await prisma.annotation.create({
      data: { documentId: doc.id, createdOnVersionId: v1.id, authorId: user.id },
    });
    expect(plain.severity).toBeNull();
    expect(plain.category).toBeNull();
    const tagged = await prisma.annotation.create({
      data: { documentId: doc.id, createdOnVersionId: v1.id, authorId: user.id, severity: "BLOCKER", category: "security" },
    });
    expect(tagged.severity).toBe("BLOCKER");
    expect(tagged.category).toBe("security");
    await prisma.document.delete({ where: { id: doc.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
```

- [ ] **Step 7: Run the tests**

Run: `CI=true pnpm test:unit tests/unit/schema.test.ts`
Expected: PASS (all `it` blocks, including the two new ones).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib/enums.ts tests/unit/schema.test.ts
git commit -m "feat(outbox): add OutboxJob table, FK indexes, Annotation severity/category, SEVERITIES enum"
```

---

### Task 2: Pure backoff function

**Goal:** Implement `computeBackoffMs(attempts)` in `lib/outbox.ts` — an explicit env-tunable delay table, clamped past the last entry. Isolated and pure (no DB).

**Files:**
- Create: `lib/outbox.ts`
- Test: `tests/unit/outbox-backoff.test.ts`

**Acceptance Criteria:**
- [ ] `computeBackoffMs(1..5)` returns `60_000, 300_000, 1_800_000, 7_200_000, 21_600_000`.
- [ ] `computeBackoffMs(6)` and beyond clamp to the last entry (`21_600_000`).
- [ ] `OUTBOX_BACKOFF_MS="10,20,30"` overrides the table (parsed as ms).

**Verify:** `CI=true pnpm test:unit tests/unit/outbox-backoff.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test** `tests/unit/outbox-backoff.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { computeBackoffMs } from "@/lib/outbox";

describe("computeBackoffMs", () => {
  afterEach(() => { delete process.env.OUTBOX_BACKOFF_MS; });

  it("returns the default table for attempts 1..5", () => {
    expect([1, 2, 3, 4, 5].map(computeBackoffMs)).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 21_600_000]);
  });

  it("clamps to the last entry past the table length", () => {
    expect(computeBackoffMs(6)).toBe(21_600_000);
    expect(computeBackoffMs(99)).toBe(21_600_000);
  });

  it("honors OUTBOX_BACKOFF_MS override", () => {
    process.env.OUTBOX_BACKOFF_MS = "10,20,30";
    expect([1, 2, 3, 4].map(computeBackoffMs)).toEqual([10, 20, 30, 30]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true pnpm test:unit tests/unit/outbox-backoff.test.ts`
Expected: FAIL — cannot resolve `computeBackoffMs` from `@/lib/outbox` (file/export missing).

- [ ] **Step 3: Create `lib/outbox.ts` with the pure backoff function**:

```ts
const DEFAULT_BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];

function backoffTable(): number[] {
  const raw = process.env.OUTBOX_BACKOFF_MS;
  if (!raw) return DEFAULT_BACKOFF_MS;
  const parsed = raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0);
  return parsed.length > 0 ? parsed : DEFAULT_BACKOFF_MS;
}

/** Delay before the n-th retry (attempts = the new, post-increment attempt count, >= 1). */
export function computeBackoffMs(attempts: number): number {
  const table = backoffTable();
  const idx = Math.min(Math.max(attempts, 1) - 1, table.length - 1);
  return table[idx];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true pnpm test:unit tests/unit/outbox-backoff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/outbox.ts tests/unit/outbox-backoff.test.ts
git commit -m "feat(outbox): add pure computeBackoffMs with env-tunable delay table"
```

---

### Task 3: Outbox engine — enqueue, handler registry, tick worker

**Goal:** Complete `lib/outbox.ts`: `enqueue`, `registerHandler`, `recoverStuckJobs`, `tick`, and `startOutboxWorker` (idempotent, `globalThis`-guarded, auto-start off under test). The worker leases due rows, runs the handler, and marks `DONE` / re-schedules with backoff / `DEAD`.

**Files:**
- Modify: `lib/outbox.ts`
- Test: `tests/unit/outbox.test.ts`

**Acceptance Criteria:**
- [ ] `enqueue(type, payload)` writes a `PENDING` row with `payload` as a JSON string; `enqueue(..., { delayMs })` sets `nextAttemptAt ≈ now+delayMs`.
- [ ] `tick()` runs the handler for a due job and marks it `DONE`.
- [ ] A throwing handler increments `attempts`, sets `nextAttemptAt = now + computeBackoffMs(attempts)`, keeps `PENDING`, and records `lastError`; on the `maxAttempts`-th failure it flips to `DEAD`.
- [ ] An unknown `type` → `DEAD` with `lastError` (no silent drop).
- [ ] `recoverStuckJobs()` flips `DELIVERING` rows back to `PENDING` (restart/crash recovery).
- [ ] `tick()` does not process jobs whose `nextAttemptAt` is in the future.
- [ ] `startOutboxWorker()` is idempotent and does not auto-start under `NODE_ENV==="test"`.

**Verify:** `CI=true pnpm test:unit tests/unit/outbox.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test** `tests/unit/outbox.test.ts` (uses the real test DB like `schema.test.ts`; resets the registry between tests):

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { enqueue, registerHandler, tick, recoverStuckJobs, startOutboxWorker, __resetHandlers } from "@/lib/outbox";

async function clearJobs() { await prisma.outboxJob.deleteMany({}); }

describe("outbox engine", () => {
  beforeEach(async () => { __resetHandlers(); await clearJobs(); });

  it("enqueue writes a PENDING row with JSON payload", async () => {
    const id = await enqueue("test.noop", { hello: "world" });
    const row = await prisma.outboxJob.findUnique({ where: { id } });
    expect(row?.status).toBe("PENDING");
    expect(JSON.parse(row!.payload)).toEqual({ hello: "world" });
  });

  it("enqueue with delayMs pushes nextAttemptAt into the future", async () => {
    const id = await enqueue("test.noop", {}, { delayMs: 60_000 });
    const row = await prisma.outboxJob.findUnique({ where: { id } });
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it("tick runs the handler and marks DONE", async () => {
    const handler = vi.fn(async () => {});
    registerHandler("test.ok", handler);
    const id = await enqueue("test.ok", { n: 1 });
    await tick();
    expect(handler).toHaveBeenCalledWith({ n: 1 });
    expect((await prisma.outboxJob.findUnique({ where: { id } }))?.status).toBe("DONE");
  });

  it("does not process jobs scheduled in the future", async () => {
    const handler = vi.fn(async () => {});
    registerHandler("test.future", handler);
    await enqueue("test.future", {}, { delayMs: 60_000 });
    await tick();
    expect(handler).not.toHaveBeenCalled();
  });

  it("unknown type goes straight to DEAD", async () => {
    const id = await enqueue("test.unregistered", {});
    await tick();
    const row = await prisma.outboxJob.findUnique({ where: { id } });
    expect(row?.status).toBe("DEAD");
    expect(row?.lastError).toMatch(/no handler/i);
  });

  it("failing handler retries with backoff then goes DEAD at maxAttempts", async () => {
    registerHandler("test.boom", async () => { throw new Error("kaboom"); });
    // maxAttempts=2 so we reach DEAD quickly; tiny backoff so re-due is immediate.
    process.env.OUTBOX_BACKOFF_MS = "0";
    const id = await enqueue("test.boom", {});
    await prisma.outboxJob.update({ where: { id }, data: { maxAttempts: 2 } });

    await tick(); // attempt 1 fails
    let row = await prisma.outboxJob.findUnique({ where: { id } });
    expect(row?.status).toBe("PENDING");
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toMatch(/kaboom/);

    await tick(); // attempt 2 fails -> DEAD (attempts >= maxAttempts)
    row = await prisma.outboxJob.findUnique({ where: { id } });
    expect(row?.status).toBe("DEAD");
    expect(row?.attempts).toBe(2);
    delete process.env.OUTBOX_BACKOFF_MS;
  });

  it("recoverStuckJobs flips DELIVERING back to PENDING", async () => {
    const id = await enqueue("test.noop", {});
    await prisma.outboxJob.update({ where: { id }, data: { status: "DELIVERING" } });
    await recoverStuckJobs();
    expect((await prisma.outboxJob.findUnique({ where: { id } }))?.status).toBe("PENDING");
  });

  it("startOutboxWorker does not auto-start under NODE_ENV=test", () => {
    // NODE_ENV is 'test' under vitest; calling it must be a no-op (no throw, no interval leak).
    expect(() => startOutboxWorker()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true pnpm test:unit tests/unit/outbox.test.ts`
Expected: FAIL — `enqueue`/`registerHandler`/`tick`/`recoverStuckJobs`/`startOutboxWorker`/`__resetHandlers` not exported.

- [ ] **Step 3: Append the engine to `lib/outbox.ts`** (below `computeBackoffMs`):

```ts
import { prisma } from "@/lib/db";

type Handler = (payload: unknown) => Promise<void>;

const globalForOutbox = globalThis as unknown as {
  outboxHandlers?: Map<string, Handler>;
  outboxTimer?: ReturnType<typeof setInterval>;
};
const handlers: Map<string, Handler> = globalForOutbox.outboxHandlers ?? new Map();
globalForOutbox.outboxHandlers = handlers;

export function registerHandler(type: string, fn: Handler): void {
  handlers.set(type, fn);
}

/** Test hook: clear the handler registry between tests. */
export function __resetHandlers(): void {
  handlers.clear();
}

export async function enqueue(
  type: string,
  payload: unknown,
  opts?: { delayMs?: number },
): Promise<string> {
  const job = await prisma.outboxJob.create({
    data: {
      type,
      payload: JSON.stringify(payload ?? null),
      nextAttemptAt: new Date(Date.now() + (opts?.delayMs ?? 0)),
    },
  });
  return job.id;
}

/** Single-worker crash recovery: any DELIVERING row is orphaned, so re-arm it. */
export async function recoverStuckJobs(): Promise<void> {
  await prisma.outboxJob.updateMany({ where: { status: "DELIVERING" }, data: { status: "PENDING" } });
}

const BATCH = Number(process.env.OUTBOX_BATCH ?? 25);
let ticking = false;

/** Process all currently-due jobs once. Serialized via an in-process guard. */
export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const now = new Date();
    const due = await prisma.outboxJob.findMany({
      where: { status: "PENDING", nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: "asc" },
      take: BATCH,
    });
    for (const job of due) {
      await prisma.outboxJob.update({ where: { id: job.id }, data: { status: "DELIVERING" } });
      const handler = handlers.get(job.type);
      if (!handler) {
        await prisma.outboxJob.update({
          where: { id: job.id },
          data: { status: "DEAD", lastError: `no handler for type "${job.type}"` },
        });
        continue;
      }
      try {
        await handler(JSON.parse(job.payload));
        await prisma.outboxJob.update({ where: { id: job.id }, data: { status: "DONE" } });
      } catch (err) {
        const attempts = job.attempts + 1;
        const lastError = err instanceof Error ? err.message : String(err);
        if (attempts >= job.maxAttempts) {
          await prisma.outboxJob.update({ where: { id: job.id }, data: { status: "DEAD", attempts, lastError } });
        } else {
          await prisma.outboxJob.update({
            where: { id: job.id },
            data: {
              status: "PENDING",
              attempts,
              lastError,
              nextAttemptAt: new Date(Date.now() + computeBackoffMs(attempts)),
            },
          });
        }
      }
    }
  } finally {
    ticking = false;
  }
}

function shouldAutoStart(): boolean {
  const flag = process.env.OUTBOX_WORKER_AUTOSTART;
  if (flag != null) return flag === "true" || flag === "1";
  return process.env.NODE_ENV !== "test";
}

/** Idempotent. Starts the polling loop once per process (globalThis-guarded). */
export function startOutboxWorker(): void {
  if (!shouldAutoStart()) return;
  if (globalForOutbox.outboxTimer) return;
  const pollMs = Number(process.env.OUTBOX_POLL_MS ?? 5_000);
  void recoverStuckJobs();
  globalForOutbox.outboxTimer = setInterval(() => { void tick(); }, pollMs);
  // Don't keep the event loop alive solely for polling.
  globalForOutbox.outboxTimer.unref?.();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true pnpm test:unit tests/unit/outbox.test.ts`
Expected: PASS (all 8 `it` blocks).

- [ ] **Step 5: Commit**

```bash
git add lib/outbox.ts tests/unit/outbox.test.ts
git commit -m "feat(outbox): enqueue, handler registry, and tick worker with backoff/dead-letter"
```

---

### Task 4: Re-home the email digest onto the outbox

**Goal:** `lib/email-digest.ts` keeps its in-memory coalescer, but on window close enqueues one `email.digest` job instead of sending inline. The render+send logic moves into a registered `email.digest` handler (`registerEmailDigestHandler()`).

**Files:**
- Modify: `lib/email-digest.ts`
- Modify: `tests/unit/email-digest.test.ts`

**Acceptance Criteria:**
- [ ] A burst of N events in one debounce window enqueues exactly one `email.digest` job whose payload carries all coalesced events.
- [ ] `enqueueEmailEvent` still early-returns (enqueues nothing) when email is unconfigured.
- [ ] The `email.digest` handler renders + sends via `sendMail` exactly once for a job; reads `userId`/`documentId`/`events` from the payload.
- [ ] `enqueueEmailEvent`'s public signature is unchanged (callers in `lib/notifications.ts` untouched).

**Verify:** `CI=true pnpm test:unit tests/unit/email-digest.test.ts` → PASS

**Steps:**

- [ ] **Step 1: Rewrite `lib/email-digest.ts`** — coalescer enqueues; handler sends. Full new file:

```ts
import { enqueue, registerHandler } from "./outbox";
import { prisma } from "./db";
import { isEmailConfigured, sendMail } from "./email";
import { renderActivityEmail, type ActivityEvent } from "./email-templates";

type Key = string; // `${userId}:${documentId}`
interface Buffer { events: ActivityEvent[]; timer: ReturnType<typeof setTimeout>; userId: string; documentId: string; }

interface DigestPayload { userId: string; documentId: string; events: ActivityEvent[]; }

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

/** Window close: hand the coalesced batch to the durable outbox (best-effort enqueue). */
async function flush(key: Key): Promise<void> {
  const buf = buffers.get(key);
  if (!buf) return;
  buffers.delete(key);
  try {
    const payload: DigestPayload = { userId: buf.userId, documentId: buf.documentId, events: buf.events };
    await enqueue("email.digest", payload);
  } catch { /* best-effort: a failed enqueue at most loses this coalescing window */ }
}

/** The durable side: render + send one coalesced digest. Runs inside the outbox worker. */
async function deliverDigest(payload: unknown): Promise<void> {
  const { userId, documentId, events } = payload as DigestPayload;
  const [user, doc] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    prisma.document.findUnique({ where: { id: documentId }, select: { title: true } }),
  ]);
  if (!user?.email || !doc) return; // recipient/doc gone — nothing to deliver
  const mail = renderActivityEmail({ recipientName: user.name, docTitle: doc.title, docId: documentId, events });
  await sendMail({ to: user.email, ...mail });
}

/** Register the email.digest handler with the outbox. Called once at server bootstrap. */
export function registerEmailDigestHandler(): void {
  registerHandler("email.digest", deliverDigest);
}
```

- [ ] **Step 2: Rewrite `tests/unit/email-digest.test.ts`** — assert one job is enqueued per window, and that the handler delivers. Mock `lib/email` and the `enqueue` half of `lib/outbox`, but keep the real `registerHandler`/`deliverDigest` path by importing the handler and invoking it:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const enqueueMock = vi.fn(async () => "job-1");
vi.mock("../../lib/outbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/outbox")>();
  return { ...actual, enqueue: enqueueMock };
});
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

describe("email digest → outbox", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); process.env.EMAIL_DEBOUNCE_MS = "50"; });
  afterEach(() => { vi.useRealTimers(); });

  it("coalesces a burst into exactly one email.digest job", async () => {
    const { enqueueEmailEvent } = await import("../../lib/email-digest");
    enqueueEmailEvent("u1", "doc1", "comment", "Al");
    enqueueEmailEvent("u1", "doc1", "comment", "Cy");
    enqueueEmailEvent("u1", "doc1", "review", "Al");
    await vi.advanceTimersByTimeAsync(60);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const [type, payload] = enqueueMock.mock.calls[0];
    expect(type).toBe("email.digest");
    expect(payload).toMatchObject({ userId: "u1", documentId: "doc1" });
    expect((payload as { events: unknown[] }).events).toHaveLength(3);
  });

  it("no-op (no enqueue) when email unconfigured", async () => {
    const email = await import("../../lib/email");
    vi.mocked(email.isEmailConfigured).mockReturnValueOnce(false);
    const { enqueueEmailEvent } = await import("../../lib/email-digest");
    enqueueEmailEvent("u2", "doc2", "comment", "Al");
    await vi.advanceTimersByTimeAsync(60);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("handler renders and sends one mail for the coalesced job", async () => {
    vi.useRealTimers();
    const email = await import("../../lib/email");
    const { registerEmailDigestHandler } = await import("../../lib/email-digest");
    const { __resetHandlers } = await import("../../lib/outbox");
    __resetHandlers();
    registerEmailDigestHandler();
    // Pull the registered handler back out and invoke it directly with a payload.
    const outbox = await import("../../lib/outbox");
    const handlers = (globalThis as unknown as { outboxHandlers: Map<string, (p: unknown) => Promise<void>> }).outboxHandlers;
    void outbox;
    await handlers.get("email.digest")!({ userId: "u1", documentId: "doc1", events: [{ type: "comment", actorName: "Al" }] });
    expect(email.sendMail).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `CI=true pnpm test:unit tests/unit/email-digest.test.ts`
Expected: PASS (3 `it` blocks).

- [ ] **Step 4: Commit**

```bash
git add lib/email-digest.ts tests/unit/email-digest.test.ts
git commit -m "feat(outbox): re-home email digest flush onto the durable outbox"
```

---

### Task 5: Worker bootstrap (`instrumentation.ts`) + env docs

**Goal:** Launch the worker once at server start via Next 16's `instrumentation.ts`, registering handlers first; document the new env vars.

**Files:**
- Create: `instrumentation.ts` (repo root)
- Modify: `.env.example`
- Test: `tests/unit/instrumentation.test.ts`

**Acceptance Criteria:**
- [ ] `register()` is a no-op when `NEXT_RUNTIME !== "nodejs"`.
- [ ] On the nodejs runtime, `register()` calls `registerEmailDigestHandler()` then `startOutboxWorker()`.
- [ ] `.env.example` documents `OUTBOX_WORKER_AUTOSTART`, `OUTBOX_POLL_MS`, `OUTBOX_BACKOFF_MS`, `OUTBOX_MAX_ATTEMPTS` (note: `OUTBOX_MAX_ATTEMPTS` is the per-job default set on the column; see step note).

**Verify:** `CI=true pnpm test:unit tests/unit/instrumentation.test.ts` → PASS

> **Note on `OUTBOX_MAX_ATTEMPTS`:** the Prisma column default is the literal `6` (Task 1). To make it env-tunable without a per-row override at enqueue time, `enqueue` does not set `maxAttempts`, so the DB default applies. Treat `OUTBOX_MAX_ATTEMPTS` as documentation of that default for this milestone; wiring it into `enqueue` (reading the env and passing `maxAttempts`) is a one-line follow-up if a deploy needs to override it. Document it in `.env.example` with that caveat.

**Steps:**

- [ ] **Step 1: Write the failing test** `tests/unit/instrumentation.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const startWorker = vi.fn();
const registerEmail = vi.fn();
vi.mock("../lib/outbox", () => ({ startOutboxWorker: startWorker }));
vi.mock("../lib/email-digest", () => ({ registerEmailDigestHandler: registerEmail }));

describe("instrumentation register()", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { delete process.env.NEXT_RUNTIME; });

  it("no-ops when not on the nodejs runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const { register } = await import("../instrumentation");
    await register();
    expect(startWorker).not.toHaveBeenCalled();
  });

  it("registers handlers then starts the worker on nodejs", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    vi.resetModules();
    const { register } = await import("../instrumentation");
    await register();
    expect(registerEmail).toHaveBeenCalledTimes(1);
    expect(startWorker).toHaveBeenCalledTimes(1);
  });
});
```

> If the relative mock paths (`../lib/outbox`) don't resolve under the `@`-alias config, switch the `vi.mock` and `import` specifiers to the `@/`-prefixed form used elsewhere in the suite. Vitest's alias from `vitest.config.ts` resolves `@/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true pnpm test:unit tests/unit/instrumentation.test.ts`
Expected: FAIL — `../instrumentation` does not exist.

- [ ] **Step 3: Create `instrumentation.ts` at the repo root**:

```ts
// Next.js calls register() once at server startup (nodejs runtime only, never at build).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerEmailDigestHandler } = await import("@/lib/email-digest");
  const { startOutboxWorker } = await import("@/lib/outbox");
  registerEmailDigestHandler();
  startOutboxWorker();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true pnpm test:unit tests/unit/instrumentation.test.ts`
Expected: PASS.

- [ ] **Step 5: Document env vars in `.env.example`** — append:

```bash
# Outbox worker (durable async delivery — email digests, later webhooks)
# Auto-starts in dev/prod; off under NODE_ENV=test. Override either way:
#   "true"/"1" force-on, "false" force-off.
OUTBOX_WORKER_AUTOSTART=
# Polling interval for due jobs, ms (default 5000).
OUTBOX_POLL_MS=
# Retry backoff delays as comma-separated ms (default 60000,300000,1800000,7200000,21600000 = 1m,5m,30m,2h,6h).
OUTBOX_BACKOFF_MS=
# Per-job max attempts before a job is dead-lettered (DB column default: 6).
OUTBOX_MAX_ATTEMPTS=
```

- [ ] **Step 6: Commit**

```bash
git add instrumentation.ts tests/unit/instrumentation.test.ts .env.example
git commit -m "feat(outbox): boot worker from instrumentation.ts; document OUTBOX_* env"
```

---

### Task 6: Full verification (suite, lint, build, e2e smoke)

**Goal:** Confirm the whole phase is green end-to-end before PR — full unit suite, lint, production build (exercises `instrumentation.ts` wiring), and the existing e2e suite.

**Files:** none (verification only)

**Acceptance Criteria:**
- [ ] `pnpm test:unit` — entire suite green (no regressions in `email-digest`, `schema`, etc.).
- [ ] `pnpm lint` — clean.
- [ ] `pnpm build` — succeeds (instrumentation compiles; no type errors).
- [ ] `pnpm test:e2e` — green (port 3000 freed first).

**Verify:** all four commands below exit 0.

**Steps:**

- [ ] **Step 1: Full unit suite**

Run: `CI=true pnpm test:unit`
Expected: all files PASS.

- [ ] **Step 2: Lint**

Run: `CI=true pnpm lint`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `CI=true pnpm build`
Expected: build completes; no TypeScript errors.

- [ ] **Step 4: Free port 3000, then e2e**

```bash
lsof -ti tcp:3000 | xargs kill -9 2>/dev/null || true
CI=true pnpm test:e2e
```
Expected: all specs PASS.

- [ ] **Step 5: Commit any incidental fixes** (only if Steps 1–4 surfaced issues):

```bash
git add -A
git commit -m "test(outbox): fix issues surfaced by full verification"
```

---

## Self-Review

**Spec coverage:**
- Durable `OutboxJob` table + worker w/ status/attempts/backoff/dead-letter → Tasks 1, 2, 3 ✓
- Email digest re-homed, 45 s coalescing kept, restart-safe → Task 4 ✓
- FK indexes + `Annotation.severity`/`category` + `SEVERITIES` → Task 1 ✓
- Worker boot at bootstrap (instrumentation.ts) + test guard → Tasks 3 (gate) + 5 (boot) ✓
- Backoff table 1m/5m/30m/2h/6h, maxAttempts=6, no jitter, env-tunable → Tasks 1 (column default) + 2 (computeBackoffMs) ✓
- Unknown type → DEAD; crash recovery (DELIVERING→PENDING) → Task 3 ✓
- Testing strategy (tick-driven, back-dated nextAttemptAt) → Tasks 2–4 ✓

**Type consistency:** `enqueue`, `registerHandler`, `tick`, `recoverStuckJobs`, `startOutboxWorker`, `computeBackoffMs`, `__resetHandlers`, `registerEmailDigestHandler` — names identical across plan tasks and tests. `email.digest` payload shape `{ userId, documentId, events }` consistent in Task 4 enqueue + handler + test. Prisma accessor `prisma.outboxJob` matches model `OutboxJob`.

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output.
