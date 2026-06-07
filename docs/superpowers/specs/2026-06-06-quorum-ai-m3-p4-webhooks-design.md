---
milestone: M3
phase: P4
slug: quorum-ai-m3-p4-webhooks
title: Outbound webhooks / status callbacks
status: design-approved
created: 2026-06-06
related:
  - docs/superpowers/specs/2026-06-06-quorum-ai-m3-roadmap.md
  - docs/superpowers/specs/2026-06-06-quorum-ai-m3-p1-foundations-outbox-design.md
---

# M3 / P4 — Outbound Webhooks / Status Callbacks

> The server-context complement to P3's long-poll. CI pipelines and headless agents
> can't hold a connection open for hours — they want to be **told** when a decision
> lands. This phase lets a user register a signed webhook that Quorum POSTs on review
> events, delivered durably via P1's outbox.

## Problem

There is no outbound integration surface. Notifications today are in-app rows + email;
nothing reaches CI, chatops, or an agent's server. Reliable delivery needs durability,
retry, and signing — exactly what P1's `OutboxJob` provides.

## Goals

- A `Webhook` registration (target URL, signing secret, event filter, scope, active).
- Signed, retried delivery via the outbox worker (handler type `webhook.deliver`).
- Events: `version.created`, `review.updated`, `decision.changed`, `comment.created`.
- Minimal management API + settings UI + a delivery log.

## Non-goals (deferred to M4+)

Dedicated Slack/Teams message formatters (generic JSON webhook only); per-event payload
templating; inbound webhooks; OAuth-protected endpoints (HMAC signing is the trust
mechanism).

---

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Delivery substrate | **Enqueue an `OutboxJob{type:"webhook.deliver"}` per (webhook, event).** Reuse P1's worker for retry/backoff/dead-letter. No new worker. |
| D2 | Signing | **HMAC-SHA256** over the raw body with the webhook's secret; send `X-Quorum-Signature: sha256=…` + `X-Quorum-Timestamp` + `X-Quorum-Event`. Receiver verifies; timestamp guards replay. |
| D3 | Scope | A webhook is **owner-scoped** (fires for the owner's documents) with an optional **single-document** narrowing — matches the owner-strict machine model from M2 P1. |
| D4 | Event source | **Hook the existing fan-out points** (`notifyParticipants` / `publish` in `lib/events.ts`) so webhooks ride the same events as in-app/SSE — one event definition, three sinks (in-app, SSE, webhook). |
| D5 | Secret handling | Secret shown **once** at creation. Unlike `ApiToken` (one-way hash — *it* verifies an incoming token), **we are the signer** and need the secret material back at delivery to compute the HMAC, so a one-way hash is impossible. Stored **AES-256-GCM encrypted at rest** (`lib/crypto.ts`, key from `WEBHOOK_SECRET_KEY`); a versioned prefix (`v1:`=AES, `v0:`=plaintext) lets dev/CI run keyless. Field is `secretEnc` (not `secretHash`). |
| D6 | Failure visibility | **Delivery log** (last status, attempts, lastError) on the `Webhook` row so an owner can see a dead webhook instead of silent loss. The handler writes `lastStatus`/`lastError`/`lastDeliveredAt` each attempt; a generic optional **`onDead` hook** added to the outbox registry fires on terminal failure and sets `lastStatus="DEAD"`. No second worker. |
| D7 | SSRF guard | `validateWebhookUrl` enforced at **create-time (400) and re-checked at delivery** (guards DNS rebinding). In `NODE_ENV==="production"`: require `https` + block loopback/link-local/private ranges. In dev/test/CI: allow `http`+localhost so the e2e sink works. |
| D8 | comment.created scope | Fired on **both** new top-level annotations and replies — matches the in-app `"comment"` notification semantics in `lib/annotations.ts`. |

---

## Data model & migration

### Schema (`prisma/schema.prisma`)

```prisma
model Webhook {
  id          String   @id @default(cuid())
  ownerId     String
  owner       User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  documentId  String?                       // null = all owner's documents
  url         String
  secretEnc   String                        // reveal-once; AES-256-GCM ciphertext (v1:) or plaintext (v0:)
  events      String                        // CSV filter: version.created,review.updated,…
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  lastStatus  String?                       // e.g. "200" | "DEAD"
  lastError   String?
  lastDeliveredAt DateTime?

  @@index([ownerId])
  @@index([documentId])
}
```

`WEBHOOK_EVENTS` value-set added to `lib/enums.ts`. Additive migration; no backfill.
A `webhooks Webhook[]` relation is added to `User`.

---

## Library + API surface

```ts
// lib/crypto.ts (new, tiny)
encryptSecret(plain: string): string   // "v1:<iv>:<tag>:<ct>" (AES-256-GCM) or "v0:<plain>" if keyless
decryptSecret(enc: string): string

// lib/webhooks.ts
createWebhook / listWebhooks / updateWebhook / deleteWebhook   // owner-scoped CRUD, mirror lib/tokens.ts
validateWebhookUrl(url: string): void                          // SSRF guard; throws on reject (D7)
dispatch(documentId: string, event: WebhookEvent, payload: unknown): Promise<void>
  // resolve doc owner → matching active webhooks (owner + optional doc scope + event-in-CSV),
  // enqueue one OutboxJob{type:"webhook.deliver"} per match.
  // envelope: { webhookId, event, planId: documentId, occurredAt, ...payload }
registerWebhookHandler(): void   // registerHandler("webhook.deliver", deliver, onDead)
```

The `webhook.deliver` handler (registered in `lib/outbox.ts` via `registerHandler`)
re-validates the URL, signs (HMAC-SHA256 over the raw body) + POSTs, and writes
`lastStatus`/`lastError`/`lastDeliveredAt` on every attempt; non-2xx throws → worker
retries per P1's backoff. The `onDead` callback sets `lastStatus="DEAD"` on terminal
failure.

`lib/outbox.ts` gains an optional third arg on `registerHandler(type, fn, onDead?)`;
`tick()` invokes the matching `onDead(payload, lastError)` (best-effort) when a job
transitions to `DEAD`. Generic — no second worker.

**Routes** (session-auth, owner-only):
- `POST /api/webhooks` — create (returns secret once).
- `GET /api/webhooks` — list owner's webhooks + delivery status.
- `PATCH /api/webhooks/[id]` — toggle active / edit filter.
- `DELETE /api/webhooks/[id]`.

**UI:** a Settings sub-page (sits beside the M2 notifications settings page) to manage
webhooks and view delivery status.

**Event wiring:** add a best-effort `dispatch(...).catch(()=>{})` call alongside the
existing `publish(...)` calls:
- `lib/versions.ts` → `version.created`; capture the document's prior `state` and also fire
  `decision.changed` when `computeDocumentState` returns a different state.
- `lib/reviews.ts` → `review.updated`; same prior-state diff for `decision.changed`.
- `lib/annotations.ts` → `comment.created` on **both** `createAnnotation` and `addComment`
  (D8 — matches the in-app `"comment"` notification).

---

## Payload (signed body)

```jsonc
{
  "event": "decision.changed",
  "planId": "doc_…",
  "decision": "approved",
  "version": 4,
  "actor": "Sam",
  "occurredAt": "…"
}
```

Kept small and stable; consumers call back `GET …/feedback` for detail (P2 contract).

---

## Testing strategy

### Unit
- `dispatch` enqueues one job per matching active webhook; respects doc-scope + event
  filter; inactive/non-matching webhooks skipped.
- Signature: deterministic HMAC for a fixed body+secret; timestamp header present.
- Handler marks delivery status; non-2xx throws (→ retry); exhausted attempts → `DEAD`
  + `lastStatus` reflected on the `Webhook`.

### Integration / e2e
- Register a webhook against a local sink; approve a plan → sink receives a signed
  `decision.changed`; tamper the body → signature check fails on the sink side.
- Sink returns 500 thrice → outbox retries then dead-letters; delivery log shows it.

### Security
- SSRF guard (`validateWebhookUrl`, D7): in production require `https` + block
  loopback/link-local/private ranges; allow `http`+localhost in dev/test/CI. Enforced at
  create-time (400) and re-checked at delivery (DNS-rebinding guard). Unit-tested against a
  table of allowed/blocked URLs under both `NODE_ENV` modes.
- Secret confidentiality: AES-256-GCM at rest, reveal-once at creation; `secretEnc` never
  returned by the list endpoint. Crypto round-trip unit-tested.

---

## Execution notes

Depends on P1 (outbox + worker). Isolated worktree; `CI=true`; rebase onto `main`;
value-sets in `lib/enums.ts`; reveal-once secret pattern mirrors `lib/tokens.ts` (but
stored encrypted, not hashed — see D5). `registerWebhookHandler()` is wired into
`instrumentation.ts` alongside `registerEmailDigestHandler()`. New env:
`WEBHOOK_SECRET_KEY` (optional; keyless `v0:` fallback for dev/CI). After pull, run the
standard `prisma migrate deploy` + `generate` per-checkout step.
