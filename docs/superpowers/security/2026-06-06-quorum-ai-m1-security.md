---
milestone: M1
slug: quorum-ai-m1
status: draft
threats_open: 10
threats_open_high: 7
asvs_level: 1
mode: retroactive-stride
created: 2026-06-06
---

# Quorum AI M1 — Security

> Retroactive STRIDE threat register for shipped M1 ("Review Core + Packaging + UI").
> Authored after the fact — M1 had no formal threat model — so the register was built from the
> implementation, then each threat verified as CLOSED (control present) or OPEN (control absent).
> This is **documentation feeding M2/P1 (Authorization)**, not an advancement gate: M1 is already
> merged. The dominant finding (a 7-threat broken-object-level-authorization cluster) is the exact
> "open-access gap" M2/P1 is scoped to close.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser → Next.js route handlers | Authenticated human users via better-auth session cookie | Document/annotation/comment/review/version payloads, SSE subscriptions |
| Claude Code → Machine API (`/api/plans*`, Bearer) | Long-lived `qai_` API token in `Authorization: Bearer …` | Plan markdown, agentContext, version updates, consolidated feedback |
| Route handler → `lib/*` service functions | Internal; services trust the `userId` the route passes | userId, documentId, annotationId, request bodies |
| App → SQLite (Prisma + better-sqlite3) | ORM-parameterized queries + one static PRAGMA | All persisted entities |
| App → environment/secrets | Process env | `BETTER_AUTH_SECRET`, `DATABASE_URL`, `DISABLE_RATE_LIMIT` |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status | Evidence |
|-----------|----------|-----------|-------------|------------|--------|----------|
| T-M1-01 | Spoofing | Auth (cookie session) | mitigate | better-auth email/password + Prisma adapter; signed session cookie via `nextCookies()` | closed | `lib/auth.ts:6-24`, `lib/api.ts:5-8` |
| T-M1-02 | Spoofing | Machine API token | mitigate | Token stored hashed (SHA-256), never plaintext; lookup by hash; `qai_` + 256-bit random | closed | `lib/tokens.ts:4-22`, `prisma/schema.prisma:79` |
| T-M1-03 | Info Disclosure | API token at rest | mitigate | Only `tokenHash` persisted; unique index; raw token shown once at creation | closed | `lib/tokens.ts:9-11`, `prisma/schema.prisma:79` |
| T-M1-04 | Tampering | SQL injection | mitigate | Prisma parameterized queries throughout; only raw call is a static `PRAGMA journal_mode=WAL` with no user input | closed | `lib/db.ts:18` |
| T-M1-05 | Tampering | Version concurrency (lost update) | mitigate | Optimistic concurrency via `baseVersionNumber` check + `$transaction` for version/re-anchor/state | closed | `lib/versions.ts:25,36-77` |
| T-M1-06 | Info Disclosure | Secret in repo | mitigate | `BETTER_AUTH_SECRET` from env; `.env` untracked; `.env.example` holds empty values | closed | `lib/auth.ts`, `.gitignore` |
| T-M1-07 | Info Disclosure | Secret logging | mitigate | No token/secret/password logged; only a generic DB-error `console.error` | closed | `lib/db.ts:18` |
| T-M1-08 | DoS | Auth-endpoint brute force | mitigate (partial) | better-auth rate limit on in production — **but** `DISABLE_RATE_LIMIT=true` disables it, and it covers auth endpoints only, not app/machine APIs | closed (partial) | `lib/auth.ts:12` |
| T-M1-09 | Repudiation | Authorship attribution | mitigate | author/reviewer/createdBy FKs on every write; `lastUsedAt` on token | closed | `prisma/schema.prisma`, `lib/tokens.ts:20` |
| T-M1-10 | Elevation of Privilege | Document read — `GET /api/documents/[id]` | mitigate → **M2/P1** | **Required:** object-level owner/participant check before returning doc. **Absent** — any authenticated user reads any document by id | **open (HIGH)** | `app/api/documents/[id]/route.ts:6-13`; `lib/documents.ts:34` (no owner filter) |
| T-M1-11 | Elevation of Privilege | Document write — PATCH new version (web + machine) | mitigate → **M2/P1** | **Required:** caller-may-edit check. **Absent** — any authenticated user / any valid token edits any document | **open (HIGH)** | `app/api/documents/[id]/route.ts:15-30`; `app/api/plans/[id]/route.ts:5-19`; `lib/versions.ts:22` |
| T-M1-12 | Elevation of Privilege | Annotations / comments create | mitigate → **M2/P1** | **Required:** doc-access check before annotate/comment. **Absent** — any user annotates/comments on any document or annotation | **open (HIGH)** | `app/api/documents/[id]/annotations/route.ts:6-34`; `app/api/annotations/[id]/comments/route.ts:5-15`; `lib/annotations.ts:7,35` |
| T-M1-13 | Elevation of Privilege | Thread status mutate — `PATCH /api/annotations/[id]` | mitigate → **M2/P1** | **Required:** ownership/participant check. **Absent** — any user resolves/reopens any thread | **open (HIGH)** | `app/api/annotations/[id]/route.ts:6-16`; `lib/annotations.ts:46` |
| T-M1-14 | Elevation of Privilege | Review submission — `POST /api/documents/[id]/reviews` | mitigate → **M2/P1** | **Required:** reviewer-eligibility check. **Absent** — any user casts/overwrites verdicts, driving a document's APPROVED/CHANGES_REQUESTED state | **open (HIGH)** | `app/api/documents/[id]/reviews/route.ts:6-16`; `lib/reviews.ts:7` |
| T-M1-15 | Info Disclosure | Machine API feedback read — `GET /api/plans/[id]/feedback` | mitigate → **M2/P1** | **Required:** token-owner-may-read-plan check. **Absent** — any valid token reads consolidated feedback (comments + reviewer names/emails) for any plan id | **open (HIGH)** | `app/api/plans/[id]/feedback/route.ts:5-12`; `lib/feedback.ts:49-53` → `lib/documents.ts:34` |
| T-M1-16 | Info Disclosure | SSE stream — `GET /api/documents/[id]/stream` | mitigate → **M2/P1** | **Required:** doc-access check before subscribe. **Absent** — any authenticated user subscribes to any document's live event feed | **open (HIGH)** | `app/api/documents/[id]/stream/route.ts:4-7` |
| T-M1-17 | Info Disclosure | Document list — `GET /api/documents` | mitigate → **M2/P1** | **Required:** scope listing to owned/participant docs. **Absent** — `listDocuments()` returns ALL documents with owner name/email to any authenticated user | **open (HIGH)** | `app/api/documents/route.ts:16-20`; `lib/documents.ts:27-31` (no `where`) |
| T-M1-18 | DoS / Spoofing | API token lifecycle | mitigate → M2/P1 | **Required:** token `expiresAt` + scope/least-privilege. **Absent** — `ApiToken` has no expiry and no scope; a leaked token is valid forever with full create+edit rights (revocation does exist) | open (medium) | `prisma/schema.prisma:75-85`; `lib/tokens.ts:8-11,32-34` |
| T-M1-19 | Spoofing (CSRF) | Cookie-session state changes | accept (verify) | better-auth ships CSRF/origin protection + SameSite cookies by default; **no explicit `trustedOrigins`** configured — confirm default origin enforcement covers all POST/PATCH routes | open (low) | `lib/auth.ts:6-24` (no `trustedOrigins`) |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Root-Cause Summary — the Open-Access Gap

T-M1-10 through T-M1-17 (7 HIGH + the document-list disclosure) share one root cause:

> **Routes authenticate the caller but never authorize the caller against the specific resource,
> and no `lib/*` service function enforces an `ownerId`/participant check.**

The single-owner column `Document.ownerId` (`prisma/schema.prisma:90`) is *written on create but never
read for authorization*. Until M2/P1 lands, M1 is effectively open-access across tenants for any
authenticated user or any valid API token (IDOR/BOLA).

### Remediation pointers (→ M2/P1 Authorization)

- **T-M1-10 / T-M1-17 (read & list):** filter by `ownerId: userId` (or participant ACL) in `getDocumentDetail` / `listDocuments`.
- **T-M1-11 (write):** verify `userId` against `doc.ownerId` in `createVersion`; applies to both the web PATCH and the machine PATCH (token's `user.id` must own the plan).
- **T-M1-12 / T-M1-13 (annotate/comment/thread):** gate on doc-access; for comments resolve `annotationId → documentId → access`.
- **T-M1-14 (reviews):** verify caller is an eligible reviewer/participant before recording a verdict.
- **T-M1-15 (machine feedback):** confirm the token's owning user owns/participates in the plan before returning feedback (PII: reviewer names/emails).
- **T-M1-16 (SSE):** apply the same per-document access check before `subscribe(id, …)`.

A single shared `assertCanAccessDocument(userId, documentId)` helper, called in every route/service above, closes the whole cluster.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|

No accepted risks. The OPEN threats are **deferred for remediation to M2/P1**, not accepted — they remain open and tracked.

---

## Secondary Findings (no separate threat — adequate for ASVS L1)

- **Input validation:** manual `typeof` checks on every route (no zod), enums allow-listed via `lib/enums.ts` (`ANNOTATION_KINDS` / `REVIEW_VERDICTS` / `THREAD_STATUSES`). No injection vector found.
- **SSRF:** no surface — no outbound `fetch` on user-controlled URLs; `BETTER_AUTH_URL` is server-config only (used to build a display `reviewUrl`).
- **Raw SQL:** none with user input (only the static WAL PRAGMA).
- **Known perf/availability follow-up (from STATUS.md):** missing FK indexes on `Annotation.authorId`, `Comment.authorId`, `Review.reviewerId`, `DocumentVersion.createdById`.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-06 | 19 | 9 | 10 (7 HIGH) | gsd-security-auditor (retroactive-STRIDE) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log (none; OPEN threats deferred to M2/P1)
- [ ] `threats_open: 0` — **NOT met** (`threats_open: 10`, 7 HIGH); resolved by M2/P1 Authorization
- [ ] `status: verified` — remains `draft` until the open-access cluster is closed

**Approval:** pending — blocked on M2/P1 Authorization (T-M1-10 … T-M1-17).
