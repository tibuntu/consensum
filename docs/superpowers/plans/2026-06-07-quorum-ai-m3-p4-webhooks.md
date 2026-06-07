# Outbound Webhooks / Status Callbacks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner register a signed, durably-delivered webhook that Quorum POSTs on `version.created` / `review.updated` / `decision.changed` / `comment.created`, riding P1's outbox for retry/backoff/dead-letter.

**Architecture:** A new `Webhook` model (owner-scoped, optional single-doc). `lib/webhooks.ts` exposes owner CRUD, a `dispatch()` that enqueues one `OutboxJob{type:"webhook.deliver"}` per matching webhook, and a delivery handler (HMAC-SHA256 signing, status logging) registered through `lib/outbox.ts`. The secret is AES-256-GCM encrypted at rest (`lib/crypto.ts`, reveal-once). A small generic `onDead` hook on the outbox surfaces terminal failures. Event wiring sits alongside existing `publish()` calls in `lib/versions.ts` / `lib/reviews.ts` / `lib/annotations.ts`. An SSRF guard (`validateWebhookUrl`) runs at create-time and delivery-time.

**Tech Stack:** Next.js (App Router) + Prisma (SQLite) + `node:crypto` + Vitest (unit) + Playwright (e2e). Reuses the merged P1 outbox.

**Spec:** `docs/superpowers/specs/2026-06-06-quorum-ai-m3-p4-webhooks-design.md`

---

### Task 0: Schema, enums, migration

**Goal:** Add the `Webhook` model + `User.webhooks` relation + `WEBHOOK_EVENTS` value-set, and run the additive migration.

**Files:**
- Modify: `prisma/schema.prisma` (add `Webhook` model; add `webhooks Webhook[]` to `User`)
- Modify: `lib/enums.ts` (append `WEBHOOK_EVENTS` + `WebhookEvent`)
- Test: `tests/unit/webhooks.schema.test.ts` (create)

**Acceptance Criteria:**
- [ ] `prisma migrate dev` creates an additive migration; `prisma generate` regenerates the client with `Webhook`.
- [ ] `WEBHOOK_EVENTS` exports `["version.created","review.updated","decision.changed","comment.created"]`.
- [ ] A `Webhook` row can be created/queried via `prisma.webhook` in a test.

**Verify:** `npm run test:unit -- webhooks.schema` → PASS

**Steps:**

- [ ] **Step 1: Add the enum value-set** to the end of `lib/enums.ts`:

```ts
export const WEBHOOK_EVENTS = ["version.created", "review.updated", "decision.changed", "comment.created"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
```

- [ ] **Step 2: Add the `Webhook` model** to `prisma/schema.prisma` (after `OutboxJob`):

```prisma
model Webhook {
  id              String   @id @default(cuid())
  ownerId         String
  owner           User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  documentId      String?                       // null = all owner's documents
  url             String
  secretEnc       String                        // reveal-once; "v1:<iv>:<tag>:<ct>" (AES-256-GCM) or "v0:<plain>"
  events          String                        // CSV filter: version.created,review.updated,…
  active          Boolean  @default(true)
  createdAt       DateTime @default(now())
  lastStatus      String?                       // e.g. "200" | "DEAD"
  lastError       String?
  lastDeliveredAt DateTime?

  @@index([ownerId])
  @@index([documentId])
}
```

- [ ] **Step 3: Add the relation field** to `model User` (alongside `apiTokens`):

```prisma
  webhooks         Webhook[]
```

- [ ] **Step 4: Run the migration and regenerate the client:**

Run: `npx prisma migrate dev --name add_webhook`
Expected: a new migration under `prisma/migrations/…_add_webhook/`, client regenerated.

- [ ] **Step 5: Write the schema test** `tests/unit/webhooks.schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { WEBHOOK_EVENTS } from "@/lib/enums";

async function makeUser() {
  const now = new Date();
  const id = `u-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return prisma.user.create({ data: { id, name: "U", email: `${id}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
}

describe("Webhook schema", () => {
  it("exposes the event value-set", () => {
    expect([...WEBHOOK_EVENTS]).toEqual(["version.created", "review.updated", "decision.changed", "comment.created"]);
  });

  it("persists an owner-scoped webhook", async () => {
    const user = await makeUser();
    const wh = await prisma.webhook.create({
      data: { ownerId: user.id, url: "https://example.com/hook", secretEnc: "v0:abc", events: "decision.changed" },
    });
    expect(wh.active).toBe(true);
    expect(wh.documentId).toBeNull();
    const found = await prisma.webhook.findUnique({ where: { id: wh.id } });
    expect(found?.url).toBe("https://example.com/hook");
  });
});
```

- [ ] **Step 6: Run the test**

Run: `npm run test:unit -- webhooks.schema`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
rtk git add prisma/schema.prisma prisma/migrations lib/enums.ts tests/unit/webhooks.schema.test.ts
rtk git commit -m "feat(webhooks): add Webhook model, WEBHOOK_EVENTS enum, migration"
```

---

### Task 1: Secret encryption (`lib/crypto.ts`)

**Goal:** A tiny reversible secret store: AES-256-GCM keyed off `WEBHOOK_SECRET_KEY`, with a `v0:` plaintext fallback when no key is set (dev/CI).

**Files:**
- Create: `lib/crypto.ts`
- Test: `tests/unit/crypto.test.ts`

**Acceptance Criteria:**
- [ ] `decryptSecret(encryptSecret(s)) === s` with a key set (`v1:` prefix) and without (`v0:` prefix).
- [ ] Tampering with the ciphertext makes `decryptSecret` throw (GCM auth tag).
- [ ] No key set → output starts with `v0:` and contains the plaintext; key set → output starts with `v1:`.

**Verify:** `npm run test:unit -- crypto` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test** `tests/unit/crypto.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

const KEY = "test-key-please-change";

describe("crypto secret store", () => {
  afterEach(() => { delete process.env.WEBHOOK_SECRET_KEY; });

  it("round-trips with a key (v1)", () => {
    process.env.WEBHOOK_SECRET_KEY = KEY;
    const enc = encryptSecret("whsec_abc123");
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain("whsec_abc123");
    expect(decryptSecret(enc)).toBe("whsec_abc123");
  });

  it("round-trips keyless (v0 plaintext fallback)", () => {
    const enc = encryptSecret("whsec_xyz");
    expect(enc).toBe("v0:whsec_xyz");
    expect(decryptSecret(enc)).toBe("whsec_xyz");
  });

  it("throws when ciphertext is tampered", () => {
    process.env.WEBHOOK_SECRET_KEY = KEY;
    const enc = encryptSecret("whsec_abc123");
    const parts = enc.split(":"); // v1:iv:tag:ct
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- crypto`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `lib/crypto.ts`:

```ts
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";

// Reversible at-rest storage for webhook signing secrets. We are the signer, so a
// one-way hash is impossible — we encrypt with an app key when present, else store
// plaintext with a version marker so dev/CI can run keyless. Format:
//   "v1:<iv_b64url>:<tag_b64url>:<ct_b64url>"  (AES-256-GCM)
//   "v0:<plaintext>"                            (no key configured)
function key(): Buffer | null {
  const raw = process.env.WEBHOOK_SECRET_KEY;
  if (!raw) return null;
  // Derive a stable 32-byte key from an arbitrary-length secret.
  return scryptSync(raw, "quorum-webhook-secret", 32);
}

export function encryptSecret(plain: string): string {
  const k = key();
  if (!k) return `v0:${plain}`;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ct.toString("base64url")}`;
}

export function decryptSecret(enc: string): string {
  if (enc.startsWith("v0:")) return enc.slice(3);
  if (enc.startsWith("v1:")) {
    const k = key();
    if (!k) throw new Error("WEBHOOK_SECRET_KEY required to decrypt a v1 secret");
    const [, ivB64, tagB64, ctB64] = enc.split(":");
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
  }
  throw new Error("unrecognized secret format");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- crypto`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add lib/crypto.ts tests/unit/crypto.test.ts
rtk git commit -m "feat(webhooks): add AES-256-GCM reveal-once secret store"
```

---

### Task 2: Outbox `onDead` hook

**Goal:** Extend the outbox registry so a handler can register an optional `onDead(payload, lastError)` callback, invoked when a job transitions to `DEAD` via attempt exhaustion. Generic, no second worker.

**Files:**
- Modify: `lib/outbox.ts` (registry + `registerHandler` signature + `tick()` dead path)
- Test: `tests/unit/outbox.test.ts` (add cases)

**Acceptance Criteria:**
- [ ] `registerHandler(type, fn, onDead?)` stores the optional callback.
- [ ] On the final failed attempt (attempts ≥ maxAttempts), `onDead(payload, lastError)` is invoked exactly once.
- [ ] `onDead` is NOT invoked on intermediate retries or on success.
- [ ] An `onDead` that throws does not crash `tick()` (best-effort) and the job still ends `DEAD`.

**Verify:** `npm run test:unit -- outbox` → PASS

**Steps:**

- [ ] **Step 1: Add failing tests** to `tests/unit/outbox.test.ts` (append inside the `describe`):

```ts
  it("invokes onDead once on attempt exhaustion, not on retries", async () => {
    process.env.OUTBOX_BACKOFF_MS = "0";
    const onDead = vi.fn(async () => {});
    registerHandler("test.dead", async () => { throw new Error("nope"); }, onDead);
    const id = await enqueue("test.dead", { k: 1 });
    await prisma.outboxJob.update({ where: { id }, data: { maxAttempts: 2 } });

    await tick(); // attempt 1 -> PENDING, no onDead
    expect(onDead).not.toHaveBeenCalled();

    await tick(); // attempt 2 -> DEAD, onDead fires
    expect(onDead).toHaveBeenCalledTimes(1);
    expect(onDead).toHaveBeenCalledWith({ k: 1 }, expect.stringMatching(/nope/));
    expect((await prisma.outboxJob.findUnique({ where: { id } }))?.status).toBe("DEAD");
    delete process.env.OUTBOX_BACKOFF_MS;
  });

  it("a throwing onDead does not break tick and the job stays DEAD", async () => {
    process.env.OUTBOX_BACKOFF_MS = "0";
    registerHandler("test.dead2", async () => { throw new Error("boom"); }, async () => { throw new Error("onDead failed"); });
    const id = await enqueue("test.dead2", {});
    await prisma.outboxJob.update({ where: { id }, data: { maxAttempts: 1 } });
    await expect(tick()).resolves.not.toThrow();
    expect((await prisma.outboxJob.findUnique({ where: { id } }))?.status).toBe("DEAD");
    delete process.env.OUTBOX_BACKOFF_MS;
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- outbox`
Expected: FAIL (`registerHandler` takes 2 args; onDead never called).

- [ ] **Step 3: Update `lib/outbox.ts`.** Replace the handler typedef + registry + `registerHandler`:

```ts
type Handler = (payload: unknown) => Promise<void>;
type DeadHandler = (payload: unknown, lastError: string) => Promise<void> | void;

const globalForOutbox = globalThis as unknown as {
  outboxHandlers?: Map<string, Handler>;
  outboxDeadHandlers?: Map<string, DeadHandler>;
  outboxTimer?: ReturnType<typeof setInterval>;
};
const handlers: Map<string, Handler> = globalForOutbox.outboxHandlers ?? new Map();
globalForOutbox.outboxHandlers = handlers;
const deadHandlers: Map<string, DeadHandler> = globalForOutbox.outboxDeadHandlers ?? new Map();
globalForOutbox.outboxDeadHandlers = deadHandlers;

export function registerHandler(type: string, fn: Handler, onDead?: DeadHandler): void {
  handlers.set(type, fn);
  if (onDead) deadHandlers.set(type, onDead);
}
```

- [ ] **Step 4: Clear dead handlers in the test hook.** Update `__resetHandlers`:

```ts
export function __resetHandlers(): void {
  handlers.clear();
  deadHandlers.clear();
}
```

- [ ] **Step 5: Invoke `onDead` in the dead path.** In `tick()`, replace the attempt-exhaustion branch:

```ts
        if (attempts >= job.maxAttempts) {
          await prisma.outboxJob.update({ where: { id: job.id }, data: { status: "DEAD", attempts, lastError } });
          const onDead = deadHandlers.get(job.type);
          if (onDead) {
            try { await onDead(JSON.parse(job.payload), lastError); }
            catch { /* best-effort: dead-letter visibility must not crash the worker */ }
          }
        } else {
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm run test:unit -- outbox`
Expected: PASS (all existing + 2 new).

- [ ] **Step 7: Commit**

```bash
rtk git add lib/outbox.ts tests/unit/outbox.test.ts
rtk git commit -m "feat(outbox): add optional onDead callback for terminal-failure visibility"
```

---

### Task 3: SSRF guard (`validateWebhookUrl`)

**Goal:** A URL validator that, in production, requires `https` and blocks loopback/link-local/private targets, with a `WEBHOOK_ALLOW_INSECURE` escape hatch for tests/self-host. Pure + table-tested.

**Files:**
- Create: `lib/webhooks.ts` (start the module with the guard + a private-IP helper)
- Test: `tests/unit/webhooks.ssrf.test.ts`

**Acceptance Criteria:**
- [ ] In `NODE_ENV=production`: `https://example.com` allowed; `http://example.com`, `https://127.0.0.1`, `https://localhost`, `https://169.254.169.254`, `https://10.0.0.5`, `https://192.168.1.1` all throw.
- [ ] In non-production: `http://localhost:9999` allowed.
- [ ] `WEBHOOK_ALLOW_INSECURE=true` allows loopback even under production.
- [ ] A non-URL string throws.

**Verify:** `npm run test:unit -- webhooks.ssrf` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test** `tests/unit/webhooks.ssrf.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { validateWebhookUrl } from "@/lib/webhooks";

const origEnv = process.env.NODE_ENV;
afterEach(() => {
  Object.defineProperty(process.env, "NODE_ENV", { value: origEnv, configurable: true });
  delete process.env.WEBHOOK_ALLOW_INSECURE;
});
function setProd() { Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true }); }

describe("validateWebhookUrl", () => {
  it("allows public https in production", () => {
    setProd();
    expect(() => validateWebhookUrl("https://example.com/hook")).not.toThrow();
  });

  it.each([
    "http://example.com/hook",
    "https://127.0.0.1/hook",
    "https://localhost/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.5/hook",
    "https://192.168.1.1/hook",
    "https://[::1]/hook",
    "not-a-url",
  ])("rejects %s in production", (url) => {
    setProd();
    expect(() => validateWebhookUrl(url)).toThrow();
  });

  it("allows http+localhost outside production", () => {
    Object.defineProperty(process.env, "NODE_ENV", { value: "test", configurable: true });
    expect(() => validateWebhookUrl("http://localhost:9999/sink")).not.toThrow();
  });

  it("honors WEBHOOK_ALLOW_INSECURE under production", () => {
    setProd();
    process.env.WEBHOOK_ALLOW_INSECURE = "true";
    expect(() => validateWebhookUrl("http://127.0.0.1:9999/sink")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- webhooks.ssrf`
Expected: FAIL (module/function missing).

- [ ] **Step 3: Create `lib/webhooks.ts`** with the guard (this is the first content of the module; later tasks append):

```ts
import { prisma } from "@/lib/db";

/** True for loopback / link-local / private-range literal IPs (v4 + minimal v6). */
export function isPrivateIp(host: string): boolean {
  const h = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 0 || a === 10) return true;          // loopback, this-host, private
  if (a === 169 && b === 254) return true;                    // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true;           // private
  if (a === 192 && b === 168) return true;                    // private
  return false;
}

/**
 * SSRF guard. In production: require https + reject loopback/link-local/private hosts
 * (literal IPs and well-known names). Outside production: permissive (http+localhost ok)
 * so the e2e sink works. `WEBHOOK_ALLOW_INSECURE=true` bypasses entirely (tests / self-host
 * pointing at internal services). Throws on rejection.
 */
export function validateWebhookUrl(url: string): void {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("invalid URL"); }
  if (process.env.WEBHOOK_ALLOW_INSECURE === "true") return;
  if (process.env.NODE_ENV !== "production") return;
  if (parsed.protocol !== "https:") throw new Error("webhook URL must use https");
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("webhook URL host not allowed");
  }
  if (isPrivateIp(host)) throw new Error("webhook URL host not allowed");
}
```

> **Note:** literal-IP + name checks are deterministic and testable. DNS-rebinding (a public name resolving to a private IP) is mitigated by re-validating at delivery time (Task 5); a full resolve-and-check is deferred per the spec's "at minimum" scope.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- webhooks.ssrf`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add lib/webhooks.ts tests/unit/webhooks.ssrf.test.ts
rtk git commit -m "feat(webhooks): add SSRF guard (validateWebhookUrl)"
```

---

### Task 4: Webhook CRUD + `dispatch`

**Goal:** Owner-scoped `createWebhook` / `listWebhooks` / `updateWebhook` / `deleteWebhook` (mirror `lib/tokens.ts`), plus `dispatch()` that resolves matching active webhooks and enqueues one outbox job each.

**Files:**
- Modify: `lib/webhooks.ts` (append CRUD + dispatch)
- Test: `tests/unit/webhooks.test.ts`

**Acceptance Criteria:**
- [ ] `createWebhook` validates the URL, generates a `whsec_…` secret, stores it encrypted, returns the plaintext secret once; `listWebhooks` never returns `secretEnc`.
- [ ] `dispatch` enqueues exactly one `webhook.deliver` job per matching active webhook; the envelope is `{ webhookId, event, planId, occurredAt, actor, ...body }`.
- [ ] Doc-scope narrowing, event-filter (CSV), and `active=false` all correctly exclude non-matching webhooks.
- [ ] `updateWebhook` / `deleteWebhook` are owner-scoped (cannot touch another owner's webhook).

**Verify:** `npm run test:unit -- webhooks.test` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test** `tests/unit/webhooks.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createWebhook, listWebhooks, updateWebhook, deleteWebhook, dispatch } from "@/lib/webhooks";

async function makeUser() {
  const now = new Date();
  const id = `u-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return prisma.user.create({ data: { id, name: "U", email: `${id}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
}
async function makeDoc(ownerId: string) {
  return prisma.document.create({ data: { title: "Doc", ownerId } });
}
async function jobsFor(webhookId: string) {
  const all = await prisma.outboxJob.findMany({ where: { type: "webhook.deliver" } });
  return all.filter((j) => JSON.parse(j.payload).webhookId === webhookId);
}

describe("webhooks service", () => {
  beforeEach(async () => { await prisma.outboxJob.deleteMany({}); });

  it("creates (reveal-once secret), lists without secret", async () => {
    const u = await makeUser();
    const { id, secret } = await createWebhook(u.id, { url: "https://example.com/h", events: ["decision.changed"] });
    expect(secret.startsWith("whsec_")).toBe(true);
    const list = await listWebhooks(u.id);
    const row = list.find((w) => w.id === id)!;
    expect(row.url).toBe("https://example.com/h");
    expect((row as Record<string, unknown>).secretEnc).toBeUndefined();
  });

  it("dispatch enqueues one job per matching active webhook", async () => {
    const u = await makeUser();
    const doc = await makeDoc(u.id);
    const a = await createWebhook(u.id, { url: "https://a.com/h", events: ["decision.changed", "review.updated"] });
    const b = await createWebhook(u.id, { url: "https://b.com/h", events: ["comment.created"] });           // wrong event
    const c = await createWebhook(u.id, { url: "https://c.com/h", events: ["decision.changed"] });
    await updateWebhook(u.id, c.id, { active: false });                                                       // inactive
    const d = await createWebhook(u.id, { url: "https://d.com/h", events: ["decision.changed"], documentId: "other-doc" }); // wrong doc

    await dispatch(doc.id, "decision.changed", { decision: "approved", version: 2 }, u.id);

    expect(await jobsFor(a.id)).toHaveLength(1);
    expect(await jobsFor(b.id)).toHaveLength(0);
    expect(await jobsFor(c.id)).toHaveLength(0);
    expect(await jobsFor(d.id)).toHaveLength(0);
    const [job] = await jobsFor(a.id);
    const payload = JSON.parse(job.payload);
    expect(payload).toMatchObject({ webhookId: a.id, event: "decision.changed", planId: doc.id, decision: "approved", version: 2, actor: "U" });
    expect(typeof payload.occurredAt).toBe("string");
  });

  it("doc-scoped webhook fires only for its document", async () => {
    const u = await makeUser();
    const doc = await makeDoc(u.id);
    const scoped = await createWebhook(u.id, { url: "https://s.com/h", events: ["review.updated"], documentId: doc.id });
    await dispatch(doc.id, "review.updated", { decision: "open" }, u.id);
    expect(await jobsFor(scoped.id)).toHaveLength(1);
  });

  it("update/delete are owner-scoped", async () => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    const { id } = await createWebhook(u1.id, { url: "https://x.com/h", events: ["comment.created"] });
    await updateWebhook(u2.id, id, { active: false });        // wrong owner: no-op
    expect((await listWebhooks(u1.id)).find((w) => w.id === id)?.active).toBe(true);
    await deleteWebhook(u2.id, id);                            // wrong owner: no-op
    expect((await listWebhooks(u1.id)).find((w) => w.id === id)).toBeTruthy();
    await deleteWebhook(u1.id, id);                            // owner: deletes
    expect((await listWebhooks(u1.id)).find((w) => w.id === id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- webhooks.test`
Expected: FAIL (CRUD/dispatch not exported).

- [ ] **Step 3: Append CRUD + dispatch** to `lib/webhooks.ts`. Add imports at the top of the file (merge with the existing `import { prisma }` line):

```ts
import { randomBytes } from "node:crypto";
import { encryptSecret } from "@/lib/crypto";
import { enqueue } from "@/lib/outbox";
import type { WebhookEvent } from "@/lib/enums";
```

Then append:

```ts
export interface CreateWebhookInput { url: string; events: WebhookEvent[]; documentId?: string | null; }

export async function createWebhook(ownerId: string, input: CreateWebhookInput) {
  validateWebhookUrl(input.url);
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const row = await prisma.webhook.create({
    data: {
      ownerId,
      url: input.url,
      documentId: input.documentId ?? null,
      events: input.events.join(","),
      secretEnc: encryptSecret(secret),
    },
  });
  return { id: row.id, secret }; // secret revealed once
}

export async function listWebhooks(ownerId: string) {
  return prisma.webhook.findMany({
    where: { ownerId },
    select: { id: true, url: true, documentId: true, events: true, active: true, createdAt: true, lastStatus: true, lastError: true, lastDeliveredAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function updateWebhook(ownerId: string, id: string, patch: { active?: boolean; events?: WebhookEvent[] }) {
  const data: { active?: boolean; events?: string } = {};
  if (patch.active !== undefined) data.active = patch.active;
  if (patch.events !== undefined) data.events = patch.events.join(",");
  await prisma.webhook.updateMany({ where: { id, ownerId }, data });
}

export async function deleteWebhook(ownerId: string, id: string) {
  await prisma.webhook.deleteMany({ where: { id, ownerId } });
}

/**
 * Fan a domain event out to every active webhook that matches (owner of the document +
 * optional single-doc narrowing + event in the CSV filter). One durable outbox job per
 * match; the worker signs + POSTs (Task 5). Best-effort: callers wrap in `.catch(()=>{})`.
 */
export async function dispatch(documentId: string, event: WebhookEvent, body: Record<string, unknown>, actorId?: string): Promise<void> {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { ownerId: true } });
  if (!doc) return;
  const candidates = await prisma.webhook.findMany({
    where: { ownerId: doc.ownerId, active: true, OR: [{ documentId: null }, { documentId }] },
  });
  const matches = candidates.filter((w) => w.events.split(",").map((s) => s.trim()).includes(event));
  if (matches.length === 0) return;

  let actor = "Someone";
  if (actorId) {
    const u = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
    actor = u?.name ?? actor;
  }
  const occurredAt = new Date().toISOString();
  for (const w of matches) {
    await enqueue("webhook.deliver", { webhookId: w.id, event, planId: documentId, occurredAt, actor, ...body });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- webhooks.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add lib/webhooks.ts tests/unit/webhooks.test.ts
rtk git commit -m "feat(webhooks): owner-scoped CRUD + dispatch (enqueue per matching webhook)"
```

---

### Task 5: Delivery handler + `registerWebhookHandler`

**Goal:** The `webhook.deliver` handler — re-validate URL, sign HMAC-SHA256 over the raw body, POST, write delivery status each attempt, throw on non-2xx (→ retry). `onDeadWebhook` sets `lastStatus="DEAD"`. `registerWebhookHandler()` wires both into the outbox.

**Files:**
- Modify: `lib/webhooks.ts` (append signing + handler + register)
- Test: `tests/unit/webhooks.deliver.test.ts`

**Acceptance Criteria:**
- [ ] `signBody(secret, body)` returns a deterministic `sha256=<hex>` HMAC for a fixed secret+body.
- [ ] Success (2xx): `lastStatus="200"`, `lastDeliveredAt` set, `lastError=null`; outgoing request carries `X-Quorum-Signature`, `X-Quorum-Timestamp`, `X-Quorum-Event`.
- [ ] Non-2xx: handler throws (so the outbox retries) and `lastStatus` reflects the code.
- [ ] `onDeadWebhook` sets `lastStatus="DEAD"` + `lastError` on the webhook row.
- [ ] `registerWebhookHandler()` registers the `webhook.deliver` handler (+ onDead).

**Verify:** `npm run test:unit -- webhooks.deliver` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test** `tests/unit/webhooks.deliver.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createWebhook, signBody, deliverWebhook, onDeadWebhook } from "@/lib/webhooks";

async function makeUser() {
  const now = new Date();
  const id = `u-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return prisma.user.create({ data: { id, name: "U", email: `${id}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
}

describe("webhook delivery", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("signBody is a deterministic sha256 HMAC", () => {
    const sig = signBody("whsec_fixed", '{"a":1}');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signBody("whsec_fixed", '{"a":1}')).toBe(sig); // deterministic
    expect(signBody("whsec_other", '{"a":1}')).not.toBe(sig);
  });

  it("delivers, signs, and records 200", async () => {
    const u = await makeUser();
    const { id, secret } = await createWebhook(u.id, { url: "https://example.com/h", events: ["decision.changed"] });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));

    await deliverWebhook({ webhookId: id, event: "decision.changed", planId: "doc1", occurredAt: "t", decision: "approved" });

    const [, init] = fetchMock.mock.calls[0];
    const headers = init!.headers as Record<string, string>;
    expect(headers["X-Quorum-Event"]).toBe("decision.changed");
    expect(headers["X-Quorum-Signature"]).toBe(signBody(secret, init!.body as string));
    expect(headers["X-Quorum-Timestamp"]).toBeTruthy();
    const row = await prisma.webhook.findUnique({ where: { id } });
    expect(row?.lastStatus).toBe("200");
    expect(row?.lastDeliveredAt).toBeTruthy();
  });

  it("throws on non-2xx and records the status", async () => {
    const u = await makeUser();
    const { id } = await createWebhook(u.id, { url: "https://example.com/h", events: ["decision.changed"] });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(deliverWebhook({ webhookId: id, event: "decision.changed", planId: "d", occurredAt: "t" })).rejects.toThrow(/500/);
    expect((await prisma.webhook.findUnique({ where: { id } }))?.lastStatus).toBe("500");
  });

  it("onDeadWebhook marks the webhook DEAD", async () => {
    const u = await makeUser();
    const { id } = await createWebhook(u.id, { url: "https://example.com/h", events: ["decision.changed"] });
    await onDeadWebhook({ webhookId: id }, "exhausted: 500");
    const row = await prisma.webhook.findUnique({ where: { id } });
    expect(row?.lastStatus).toBe("DEAD");
    expect(row?.lastError).toMatch(/exhausted/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- webhooks.deliver`
Expected: FAIL (functions missing).

- [ ] **Step 3: Append** to `lib/webhooks.ts`. Add to the `node:crypto` import: `createHmac`. Add `import { registerHandler } from "@/lib/outbox";` (merge with the existing `enqueue` import → `import { enqueue, registerHandler } from "@/lib/outbox";`). Add `import { decryptSecret } from "@/lib/crypto";` (merge with the `encryptSecret` import). Then append:

```ts
export function signBody(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

interface DeliverPayload { webhookId: string; event: string; [k: string]: unknown; }

function isDeliverPayload(v: unknown): v is DeliverPayload {
  return typeof v === "object" && v !== null && typeof (v as DeliverPayload).webhookId === "string" && typeof (v as DeliverPayload).event === "string";
}

/** The durable side: sign + POST one webhook event. Runs inside the outbox worker. */
export async function deliverWebhook(payload: unknown): Promise<void> {
  if (!isDeliverPayload(payload)) throw new Error("webhook.deliver: malformed payload");
  const wh = await prisma.webhook.findUnique({ where: { id: payload.webhookId } });
  if (!wh) return; // webhook deleted between enqueue and delivery — nothing to do
  validateWebhookUrl(wh.url); // re-check at delivery (DNS-rebinding guard)

  const body = JSON.stringify(payload);
  const secret = decryptSecret(wh.secretEnc);
  const timestamp = new Date().toISOString();
  try {
    const res = await fetch(wh.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Quorum-Event": payload.event,
        "X-Quorum-Timestamp": timestamp,
        "X-Quorum-Signature": signBody(secret, body),
      },
      body,
    });
    if (res.status < 200 || res.status >= 300) {
      await prisma.webhook.update({ where: { id: wh.id }, data: { lastStatus: String(res.status), lastError: `non-2xx: ${res.status}` } });
      throw new Error(`webhook delivery failed: ${res.status}`); // → outbox retries
    }
    await prisma.webhook.update({ where: { id: wh.id }, data: { lastStatus: String(res.status), lastDeliveredAt: new Date(), lastError: null } });
  } catch (err) {
    if (err instanceof Error && /webhook delivery failed/.test(err.message)) throw err; // already recorded
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.webhook.update({ where: { id: wh.id }, data: { lastStatus: "ERR", lastError: msg } });
    throw err; // network error → outbox retries
  }
}

/** Terminal failure: surface DEAD on the webhook row so the owner sees a dead endpoint. */
export async function onDeadWebhook(payload: unknown, lastError: string): Promise<void> {
  if (!isDeliverPayload(payload)) return;
  await prisma.webhook.updateMany({ where: { id: payload.webhookId }, data: { lastStatus: "DEAD", lastError } });
}

/** Register the webhook.deliver handler (+ onDead) with the outbox. Called at bootstrap. */
export function registerWebhookHandler(): void {
  registerHandler("webhook.deliver", deliverWebhook, onDeadWebhook);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- webhooks.deliver`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add lib/webhooks.ts tests/unit/webhooks.deliver.test.ts
rtk git commit -m "feat(webhooks): HMAC-signed delivery handler + onDead DEAD marking"
```

---

### Task 6: Bootstrap wiring (`instrumentation.ts`)

**Goal:** Register the webhook handler at server startup alongside the email-digest handler.

**Files:**
- Modify: `instrumentation.ts`
- Test: `tests/unit/instrumentation.test.ts` (update)

**Acceptance Criteria:**
- [ ] `register()` calls `registerWebhookHandler()` once on the nodejs runtime, before/with `startOutboxWorker()`.
- [ ] No-op on non-nodejs runtime (unchanged).

**Verify:** `npm run test:unit -- instrumentation` → PASS

**Steps:**

- [ ] **Step 1: Update the test** `tests/unit/instrumentation.test.ts`. Add the mock + assertions:

```ts
const registerWebhook = vi.fn();
vi.mock("@/lib/webhooks", () => ({ registerWebhookHandler: registerWebhook }));
```

In the "no-ops when not on the nodejs runtime" test, add: `expect(registerWebhook).not.toHaveBeenCalled();`
In the "registers handlers then starts the worker on nodejs" test, add: `expect(registerWebhook).toHaveBeenCalledTimes(1);`

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- instrumentation`
Expected: FAIL (`registerWebhookHandler` not called).

- [ ] **Step 3: Update `instrumentation.ts`:**

```ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerEmailDigestHandler } = await import("@/lib/email-digest");
  const { registerWebhookHandler } = await import("@/lib/webhooks");
  const { startOutboxWorker } = await import("@/lib/outbox");
  registerEmailDigestHandler();
  registerWebhookHandler();
  startOutboxWorker();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- instrumentation`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add instrumentation.ts tests/unit/instrumentation.test.ts
rtk git commit -m "feat(webhooks): register delivery handler at bootstrap"
```

---

### Task 7: Management API routes

**Goal:** `POST/GET/PATCH/DELETE /api/webhooks` — session-auth, owner-only, mirror `app/api/tokens`. POST validates URL (400 on reject) and returns the secret once.

**Files:**
- Create: `app/api/webhooks/route.ts` (GET, POST)
- Create: `app/api/webhooks/[id]/route.ts` (PATCH, DELETE)
- Test: `tests/unit/webhooks.routes.test.ts`

**Acceptance Criteria:**
- [ ] `POST` with no session → 401; valid → 201 `{ id, secret }`; invalid URL → 400; bad/missing events → 400.
- [ ] `GET` returns the owner's webhooks (no `secretEnc`).
- [ ] `PATCH` toggles `active` / edits events for an owned webhook; `DELETE` removes it.

**Verify:** `npm run test:unit -- webhooks.routes` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test** `tests/unit/webhooks.routes.test.ts` (mock `requireUser` like a route test; assert request validation):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const user = { id: "owner-1" };
vi.mock("@/lib/api", () => ({ requireUser: vi.fn(async () => user) }));

import { prisma } from "@/lib/db";
import * as api from "@/lib/api";

async function ensureUser() {
  const now = new Date();
  await prisma.user.upsert({ where: { id: user.id }, update: {}, create: { id: user.id, name: "Owner", email: `${user.id}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
}

describe("/api/webhooks", () => {
  beforeEach(async () => { vi.mocked(api.requireUser).mockResolvedValue(user as never); await ensureUser(); await prisma.webhook.deleteMany({ where: { ownerId: user.id } }); });

  it("401 without a session", async () => {
    vi.mocked(api.requireUser).mockResolvedValueOnce(null as never);
    const { POST } = await import("@/app/api/webhooks/route");
    const res = await POST(new Request("http://t/api/webhooks", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });

  it("creates and lists (no secret in list)", async () => {
    const { POST, GET } = await import("@/app/api/webhooks/route");
    const res = await POST(new Request("http://t/api/webhooks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com/h", events: ["decision.changed"] }) }));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.secret.startsWith("whsec_")).toBe(true);

    const list = await (await GET()).json();
    expect(list.webhooks[0].url).toBe("https://example.com/h");
    expect(list.webhooks[0].secretEnc).toBeUndefined();
  });

  it("400 on invalid url / bad events", async () => {
    const { POST } = await import("@/app/api/webhooks/route");
    const bad = await POST(new Request("http://t", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "not-a-url", events: ["decision.changed"] }) }));
    expect(bad.status).toBe(400);
    const noEvents = await POST(new Request("http://t", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com/h", events: [] }) }));
    expect(noEvents.status).toBe(400);
  });
});
```

> Note: this test runs with `NODE_ENV=test`, so `validateWebhookUrl` only rejects unparseable URLs (`not-a-url`), which is what the 400 case asserts.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- webhooks.routes`
Expected: FAIL (routes missing).

- [ ] **Step 3: Create `app/api/webhooks/route.ts`:**

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { createWebhook, listWebhooks } from "@/lib/webhooks";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/enums";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ webhooks: await listWebhooks(user.id) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.url !== "string") return NextResponse.json({ error: "url required" }, { status: 400 });
  const events = Array.isArray(body.events)
    ? body.events.filter((e: unknown): e is WebhookEvent => typeof e === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(e))
    : [];
  if (events.length === 0) return NextResponse.json({ error: "at least one valid event required" }, { status: 400 });
  const documentId = typeof body.documentId === "string" && body.documentId.trim() ? body.documentId : null;
  try {
    const { id, secret } = await createWebhook(user.id, { url: body.url, events, documentId });
    return NextResponse.json({ id, secret }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "invalid webhook" }, { status: 400 });
  }
}
```

- [ ] **Step 4: Create `app/api/webhooks/[id]/route.ts`:**

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { updateWebhook, deleteWebhook } from "@/lib/webhooks";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/enums";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const patch: { active?: boolean; events?: WebhookEvent[] } = {};
  if (typeof body.active === "boolean") patch.active = body.active;
  if (Array.isArray(body.events)) {
    patch.events = body.events.filter((e: unknown): e is WebhookEvent => typeof e === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(e));
  }
  await updateWebhook(user.id, id, patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await deleteWebhook(user.id, id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:unit -- webhooks.routes`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
rtk git add app/api/webhooks tests/unit/webhooks.routes.test.ts
rtk git commit -m "feat(webhooks): owner-only management API routes"
```

---

### Task 8: Event wiring (version / review / decision / comment)

**Goal:** Fire `dispatch()` alongside the existing `publish()` calls; synthesize `decision.changed` on a real state transition.

**Files:**
- Modify: `lib/versions.ts` (capture prior state; dispatch `version.created` + maybe `decision.changed`)
- Modify: `lib/reviews.ts` (capture prior state; dispatch `review.updated` + maybe `decision.changed`)
- Modify: `lib/annotations.ts` (dispatch `comment.created` in `createAnnotation` + `addComment`)
- Test: `tests/unit/webhooks.wiring.test.ts`

**Acceptance Criteria:**
- [ ] Submitting a review that changes the document state enqueues both a `review.updated` and a `decision.changed` webhook job (for a matching webhook); a review that doesn't change state enqueues only `review.updated`.
- [ ] Creating a version enqueues `version.created` (+ `decision.changed` if state changed).
- [ ] Adding a comment enqueues `comment.created`.
- [ ] All `dispatch` calls are best-effort (`.catch(() => {})`) and never block the existing flow.

**Verify:** `npm run test:unit -- webhooks.wiring` → PASS

**Steps:**

- [ ] **Step 1: Write the failing test** `tests/unit/webhooks.wiring.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createWebhook } from "@/lib/webhooks";
import { submitReview } from "@/lib/reviews";
import { addComment } from "@/lib/annotations";

async function makeUser() {
  const now = new Date();
  const id = `u-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return prisma.user.create({ data: { id, name: "U", email: `${id}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
}
async function makeDocWithVersion(ownerId: string) {
  const doc = await prisma.document.create({ data: { title: "D", ownerId, requiredApprovals: 1 } });
  const v = await prisma.documentVersion.create({ data: { documentId: doc.id, versionNumber: 1, markdown: "hello world", contentHash: "h1", createdById: ownerId } });
  await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: v.id } });
  return doc;
}
async function eventsFor(webhookId: string): Promise<string[]> {
  const jobs = await prisma.outboxJob.findMany({ where: { type: "webhook.deliver" } });
  return jobs.map((j) => JSON.parse(j.payload)).filter((p) => p.webhookId === webhookId).map((p) => p.event);
}

describe("event wiring → webhooks", () => {
  beforeEach(async () => { await prisma.outboxJob.deleteMany({}); });

  it("review approval fires review.updated AND decision.changed", async () => {
    const u = await makeUser();
    const doc = await makeDocWithVersion(u.id);
    const { id } = await createWebhook(u.id, { url: "https://e.com/h", events: ["review.updated", "decision.changed"] });
    await submitReview(u.id, doc.id, "APPROVE"); // DRAFT/OPEN -> APPROVED: state changes
    const evts = await eventsFor(id);
    expect(evts).toContain("review.updated");
    expect(evts).toContain("decision.changed");
  });

  it("comment fires comment.created", async () => {
    const u = await makeUser();
    const doc = await makeDocWithVersion(u.id);
    const ann = await prisma.annotation.create({ data: { documentId: doc.id, createdOnVersionId: doc.currentVersionId!, kind: "COMMENT", authorId: u.id } });
    const { id } = await createWebhook(u.id, { url: "https://e.com/h", events: ["comment.created"] });
    await addComment(u.id, ann.id, "a reply");
    expect(await eventsFor(id)).toContain("comment.created");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- webhooks.wiring`
Expected: FAIL (no webhook jobs enqueued yet).

- [ ] **Step 3: Wire `lib/reviews.ts`.** Add import `import { dispatch } from "@/lib/webhooks";`. Capture prior state and dispatch. Replace the body after computing reviews:

```ts
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { currentVersionId: true, requiredApprovals: true, state: true } });
  if (!doc?.currentVersionId) throw new Error("document has no current version");
  const prevState = doc.state;

  // …unchanged: delete/create review, recompute `state`, update document…

  publish(documentId, { type: "review.updated", state });
  await notifyParticipants(documentId, userId, "review").catch(() => {});
  await dispatch(documentId, "review.updated", { decision: state.toLowerCase() }, userId).catch(() => {});
  if (state !== prevState) {
    await dispatch(documentId, "decision.changed", { decision: state.toLowerCase() }, userId).catch(() => {});
  }
  return state;
```

(Only the `select` gets `state: true`, `prevState` is captured, and the two `dispatch` lines + the `if` are added. Leave the review delete/create/recompute logic exactly as-is.)

- [ ] **Step 4: Wire `lib/versions.ts`.** Add import `import { dispatch } from "@/lib/webhooks";`. `doc` is already fetched with `include: { currentVersion: true }`; `Document.state` is available on `doc`. Capture `const prevState = doc.state;` near the top (after the `doc` null-check). After the existing publish/notify (lines 96–97), add:

```ts
  await dispatch(documentId, "version.created", { version: version.versionNumber }, userId).catch(() => {});
  if (state !== prevState) {
    await dispatch(documentId, "decision.changed", { decision: state.toLowerCase(), version: version.versionNumber }, userId).catch(() => {});
  }
```

- [ ] **Step 5: Wire `lib/annotations.ts`.** Add import `import { dispatch } from "@/lib/webhooks";`. In `createAnnotation`, after the existing publish/notify:

```ts
  await dispatch(documentId, "comment.created", { annotationId: annotation.id }, userId).catch(() => {});
```

In `addComment`, after the existing publish/notify (inside the `if (ann)` flow), add:

```ts
  if (ann) await dispatch(ann.documentId, "comment.created", { annotationId }, userId).catch(() => {});
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm run test:unit -- webhooks.wiring`
Expected: PASS

- [ ] **Step 7: Run the full lib suite** to confirm no regressions in reviews/versions/annotations tests:

Run: `npm run test:unit -- reviews versions annotations`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
rtk git add lib/reviews.ts lib/versions.ts lib/annotations.ts tests/unit/webhooks.wiring.test.ts
rtk git commit -m "feat(webhooks): dispatch events alongside publish/notify; synthesize decision.changed"
```

---

### Task 9: Settings UI (WebhookManager)

**Goal:** A `WebhookManager` client component + `app/app/settings/webhooks/page.tsx` + a "Webhooks" link in the settings subnav. Minimal/functional (polish deferred per the deferred-UI note).

**Files:**
- Create: `components/WebhookManager.tsx`
- Create: `app/app/settings/webhooks/page.tsx`
- Modify: `app/app/settings/layout.tsx` (add subnav link)

**Acceptance Criteria:**
- [ ] Page lists the owner's webhooks with `lastStatus`/`lastDeliveredAt`, a create form (url + event checkboxes), reveal-once secret display, and delete.
- [ ] Subnav shows a "Webhooks" link beside "Notifications" / "API tokens".
- [ ] `npm run build` succeeds (component type-checks).

**Verify:** `npm run build` → success; e2e in Task 10 exercises the flow.

**Steps:**

- [ ] **Step 1: Add the subnav link** in `app/app/settings/layout.tsx` (after the API tokens link):

```tsx
        <Link href="/app/settings/webhooks" className="text-foreground hover:text-primary">Webhooks</Link>
```

- [ ] **Step 2: Create `app/app/settings/webhooks/page.tsx`** (mirror the tokens page):

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listWebhooks } from "@/lib/webhooks";
import WebhookManager from "@/components/WebhookManager";

export default async function WebhooksPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const webhooks = await listWebhooks(session.user.id);
  return (
    <div className="flex w-full max-w-3xl flex-col gap-8">
      <WebhookManager initialWebhooks={webhooks} />
    </div>
  );
}
```

- [ ] **Step 3: Create `components/WebhookManager.tsx`** (mirror `TokenManager`; create form, reveal-once secret, list with status, delete):

```tsx
"use client";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/enums";

type WebhookRow = {
  id: string; url: string; events: string; active: boolean;
  lastStatus: string | null; lastDeliveredAt: Date | string | null;
};

export default function WebhookManager({ initialWebhooks }: { initialWebhooks: WebhookRow[] }) {
  const [hooks, setHooks] = useState<WebhookRow[]>(initialWebhooks);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>(["decision.changed"]);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function toggle(e: WebhookEvent) {
    setEvents((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSubmitting(true);
    try {
      const res = await fetch("/api/webhooks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, events }) });
      if (res.status !== 201) { setError((await res.json().catch(() => null))?.error ?? "Failed to create webhook"); return; }
      const { id, secret } = await res.json();
      setCreated(secret);
      setHooks((prev) => [{ id, url, events: events.join(","), active: true, lastStatus: null, lastDeliveredAt: null }, ...prev]);
      setUrl("");
    } finally { setSubmitting(false); }
  }

  async function onDelete(id: string) {
    await fetch(`/api/webhooks/${id}`, { method: "DELETE" });
    setHooks((prev) => prev.filter((h) => h.id !== id));
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-foreground">Webhooks</h1>

      <Card className="p-4">
        <form onSubmit={onCreate} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Endpoint URL
            <Input aria-label="webhook url" placeholder="https://ci.example.com/quorum" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <fieldset className="flex flex-col gap-1 text-sm text-foreground">
            <legend className="text-xs text-muted">Events</legend>
            {WEBHOOK_EVENTS.map((e) => (
              <label key={e} className="flex items-center gap-2">
                <input type="checkbox" aria-label={e} checked={events.includes(e)} onChange={() => toggle(e)} />
                {e}
              </label>
            ))}
          </fieldset>
          <Button type="submit" disabled={submitting || events.length === 0 || !url}>Create webhook</Button>
        </form>
      </Card>

      {error && <p role="alert" className="text-sm text-[var(--state-changes)]">{error}</p>}

      {created && (
        <Card className="flex flex-col gap-2 border-[var(--state-approved)] bg-[var(--state-approved-bg)] p-4">
          <p className="text-sm font-medium text-foreground">Copy this signing secret now — it won&apos;t be shown again.</p>
          <Input data-testid="new-webhook-secret" readOnly value={created} className="font-mono" onFocus={(e) => e.currentTarget.select()} />
          <Button variant="ghost" size="sm" onClick={() => setCreated(null)} className="self-start">Done</Button>
        </Card>
      )}

      {hooks.length === 0 ? (
        <Card className="p-6 text-sm text-muted">No webhooks yet.</Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {hooks.map((h) => (
            <li key={h.id}>
              <Card className="flex items-center justify-between gap-4 p-3" data-testid="webhook-row">
                <span className="flex flex-col">
                  <span className="font-medium text-foreground">{h.url}</span>
                  <span className="text-xs text-muted">{h.events}</span>
                  <span className="text-xs text-muted" data-testid="webhook-status">
                    {h.lastStatus ? `Last: ${h.lastStatus}${h.lastDeliveredAt ? ` @ ${new Date(h.lastDeliveredAt).toLocaleString()}` : ""}` : "Never delivered"}
                  </span>
                </span>
                <Button variant="danger" size="sm" onClick={() => onDelete(h.id)}>Delete</Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Build to confirm types**

Run: `npm run build`
Expected: success (no type errors).

- [ ] **Step 5: Commit**

```bash
rtk git add components/WebhookManager.tsx app/app/settings/webhooks/page.tsx app/app/settings/layout.tsx
rtk git commit -m "feat(webhooks): settings UI to manage webhooks + delivery status"
```

---

### Task 10: End-to-end delivery + dead-letter

**Goal:** Prove signed delivery against a local sink (happy path + tamper detection) via Playwright, and the retry→dead-letter→DEAD path deterministically at the lib level via `tick()`.

**Files:**
- Modify: `playwright.config.ts` (webServer `env`: `WEBHOOK_ALLOW_INSECURE`, fast outbox polling)
- Create: `tests/e2e/webhooks.spec.ts`
- Create: `tests/unit/webhooks.deadletter.test.ts`

**Acceptance Criteria:**
- [ ] e2e: register a webhook (UI) → approve a plan → local sink receives a POST whose `X-Quorum-Signature` verifies against the revealed secret and whose body parses to `event:"decision.changed"`.
- [ ] e2e: a wrong-secret HMAC recomputation does NOT match the received signature (tamper/forgery would fail receiver verification).
- [ ] unit: a webhook whose endpoint returns 500 is retried to exhaustion via repeated `tick()`, ending `OutboxJob.status="DEAD"` and `Webhook.lastStatus="DEAD"`.

**Verify:** `npm run test:unit -- webhooks.deadletter` → PASS; `CI=true npm run test:e2e -- webhooks` → PASS

**Steps:**

- [ ] **Step 1: Add the dead-letter unit test** `tests/unit/webhooks.deadletter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createWebhook, registerWebhookHandler } from "@/lib/webhooks";
import { enqueue, tick, __resetHandlers } from "@/lib/outbox";

async function makeUser() {
  const now = new Date();
  const id = `u-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return prisma.user.create({ data: { id, name: "U", email: `${id}@ex.com`, emailVerified: false, createdAt: now, updatedAt: now } });
}

describe("webhook dead-letter", () => {
  beforeEach(async () => { __resetHandlers(); await prisma.outboxJob.deleteMany({}); });

  it("retries a 500 endpoint to exhaustion → DEAD on job and webhook", async () => {
    process.env.OUTBOX_BACKOFF_MS = "0";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("err", { status: 500 }));
    registerWebhookHandler();
    const u = await makeUser();
    const { id } = await createWebhook(u.id, { url: "https://example.com/h", events: ["decision.changed"] });
    const jobId = await enqueue("webhook.deliver", { webhookId: id, event: "decision.changed", planId: "d", occurredAt: "t" });
    await prisma.outboxJob.update({ where: { id: jobId }, data: { maxAttempts: 2 } });

    await tick(); // attempt 1 -> PENDING
    await tick(); // attempt 2 -> DEAD + onDead

    expect((await prisma.outboxJob.findUnique({ where: { id: jobId } }))?.status).toBe("DEAD");
    expect((await prisma.webhook.findUnique({ where: { id } }))?.lastStatus).toBe("DEAD");
    delete process.env.OUTBOX_BACKOFF_MS;
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run to verify it passes** (handler + onDead already implemented in Tasks 2 & 5):

Run: `npm run test:unit -- webhooks.deadletter`
Expected: PASS

- [ ] **Step 3: Set Playwright env.** In `playwright.config.ts`, extend `webServer.env`:

```ts
    env: { DISABLE_RATE_LIMIT: "true", WEBHOOK_ALLOW_INSECURE: "true", OUTBOX_POLL_MS: "500" },
```

(`WEBHOOK_ALLOW_INSECURE` lets the production build POST to the loopback sink; `OUTBOX_POLL_MS=500` makes the worker pick up jobs quickly so the test doesn't wait the 5s default.)

- [ ] **Step 4: Write the e2e** `tests/e2e/webhooks.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";

async function register(page: Page): Promise<void> {
  const email = `wh-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("Hooker");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);
}

interface Received { headers: Record<string, string | string[] | undefined>; body: string; }

function startSink(): Promise<{ server: Server; port: number; received: Received[] }> {
  const received: Received[] = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => { received.push({ headers: req.headers, body }); res.writeHead(200); res.end("ok"); });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 0, received });
    });
  });
}

test("signed webhook delivery on approval", async ({ page }) => {
  const { server, port, received } = await startSink();
  try {
    await register(page);

    // Register a webhook pointing at the local sink.
    await page.goto("/app/settings/webhooks");
    await page.getByLabel("webhook url").fill(`http://127.0.0.1:${port}/sink`);
    await page.getByLabel("decision.changed").check();
    await page.getByRole("button", { name: "Create webhook" }).click();
    const secret = await page.getByTestId("new-webhook-secret").inputValue();
    expect(secret.startsWith("whsec_")).toBe(true);

    // Create a plan and approve it → decision.changed.
    await page.goto("/app");
    await page.getByLabel("title").fill("Webhook Plan");
    await page.getByLabel("markdown").fill("Content to approve.");
    await page.getByRole("button", { name: "Create document" }).click();
    await expect(page).toHaveURL(/\/app\/documents\//);
    await page.getByRole("button", { name: /approve/i }).click();

    // Wait for the outbox worker to deliver (poll interval 500ms in test).
    await expect.poll(() => received.length, { timeout: 15_000 }).toBeGreaterThan(0);

    const hit = received.find((r) => {
      try { return JSON.parse(r.body).event === "decision.changed"; } catch { return false; }
    })!;
    expect(hit).toBeTruthy();
    const expected = `sha256=${createHmac("sha256", secret).update(hit.body).digest("hex")}`;
    expect(hit.headers["x-quorum-signature"]).toBe(expected);
    expect(hit.headers["x-quorum-event"]).toBe("decision.changed");
    expect(hit.headers["x-quorum-timestamp"]).toBeTruthy();

    // Tamper: a wrong secret must not reproduce the signature (forgery fails verification).
    const forged = `sha256=${createHmac("sha256", "whsec_wrong").update(hit.body).digest("hex")}`;
    expect(forged).not.toBe(hit.headers["x-quorum-signature"]);
  } finally {
    server.close();
  }
});
```

> **Note:** the approve button label/selector must match the existing review UI. If `review.spec.ts` uses a different accessible name, copy that selector here. Verify against `tests/e2e/review.spec.ts` during execution.

- [ ] **Step 5: Run the e2e**

Run: `CI=true npm run test:e2e -- webhooks`
Expected: PASS (sink receives a correctly-signed `decision.changed`).

- [ ] **Step 6: Commit**

```bash
rtk git add playwright.config.ts tests/e2e/webhooks.spec.ts tests/unit/webhooks.deadletter.test.ts
rtk git commit -m "test(webhooks): e2e signed delivery + tamper; lib dead-letter coverage"
```

---

## Final verification

- [ ] `npm run test:unit` → all PASS
- [ ] `CI=true npm run test:e2e` → all PASS
- [ ] `npm run lint` → clean
- [ ] `npm run build` → success
- [ ] Rebase onto `main` (per project convention — rebase, don't merge).
