# M4 · P1 — Ownership Governance (design)

> Phase spec for M4 P1. Parent roadmap: `specs/2026-06-08-quorum-ai-m4-roadmap.md`.
> Two independent ownership rules: (1) a document owner cannot issue review verdicts on their own document; (2) the owner can hard-delete their own document.

## Problem

- **Self-approval.** A document's owner is added as a participant at creation (`lib/documents.ts:24`), so `isParticipant()` returns true for them and `POST /api/documents/[id]/reviews` lets them submit any verdict — including APPROVE — on their own document. There is no owner check in the route or in `submitReview()` (`lib/reviews.ts:8`).
- **No deletion.** There is no way to delete a document/plan: no `DELETE` route, no service function, no UI. Once created, a document is permanent.

## Decisions (locked)

- **Block all owner verdicts** (not just APPROVE). The owner may not submit APPROVE, REQUEST_CHANGES, or COMMENT *verdicts* on their own document. Annotation comment threads are unaffected — this is strictly the `Review` verdict model.
- **Owner-only hard delete.** Only the owner deletes; the row and its dependents are removed permanently. No soft-delete, no admin role (deferred → M5+).
- Document-state computation is unchanged — we simply keep the owner out of the reviewer set; we do **not** introduce a quorum/N-approver threshold.

## Part 1 — Block owner verdicts

### Server (the guard)
`app/api/documents/[id]/reviews/route.ts` — after the existing `isParticipant` check (line 11), add an owner block:

```ts
if (await isOwner(user.id, id)) {
  return NextResponse.json({ error: "owners cannot review their own document" }, { status: 403 });
}
```

`isOwner` is already exported from `lib/authz.ts`. This is the authoritative guard; the machine API path that reaches `submitReview()` is the same route, so the check covers API callers too.

### Client (UX)
The verdict controls (Approve / Request changes buttons) must be hidden when the viewer is the owner, so they aren't offered an action that 403s. `isOwner` is already a prop on `DocumentView` (`app/app/documents/[id]/page.tsx:37` → `components/DocumentView.tsx:64`). The plan will locate the verdict-control JSX and wrap it in `!isOwner`. A short inline note ("You can't review your own document") is acceptable but optional.

### Tests
- Unit/integration: owner POST to reviews → 403; non-owner participant → 200 (unchanged). Existing review tests must stay green.
- A test asserting the owner is still a participant (so GET/annotation flows are unaffected).

## Part 2 — Owner-only hard delete

### Route
New `DELETE` handler in `app/api/documents/[id]/route.ts`, mirroring the PATCH authorization ladder (404 for non-participant to avoid leaking existence, 403 for non-owner):

```ts
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isParticipant(user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await isOwner(user.id, id))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await deleteDocument(id);
  return NextResponse.json({ ok: true });
}
```

### Service — `deleteDocument(id)` in `lib/documents.ts`
The cascade cannot be a single `prisma.document.delete`: deleting a Document cascades to its `DocumentVersion` rows, but `Annotation.createdOnVersion` (schema:140), `Annotation.appliedInVersion` (schema:157), and `Review.onVersion` (schema:186) all have `onDelete: Restrict` against `DocumentVersion`, which would abort the cascade.

Delete in dependency order inside a single transaction so no `Restrict` referrer remains when versions are removed:

```ts
export async function deleteDocument(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.review.deleteMany({ where: { documentId: id } }),       // clears Review.onVersion Restrict
    prisma.annotation.deleteMany({ where: { documentId: id } }),    // clears both Annotation→version Restricts; cascades Comments
    prisma.document.delete({ where: { id } }),                      // cascades versions, participants, notifications
  ]);
}
```

`Comment` cascades from `Annotation` (schema:168); `DocumentVersion`, `DocumentParticipant`, and `Notification` cascade from `Document`. Outbox jobs / webhooks are owner- or document-decoupled and out of scope for cascade (no FK to Document that would block).

Rationale for this over a schema migration flipping the three `Restrict` FKs to `Cascade`: those `Restrict` rules protect *version-level* operations (you can't delete a single version an annotation still points at) and changing them has blast radius beyond delete. An ordered transactional delete is local to this feature.

### UI
A **Delete** button in the document header actions (`components/DocumentView.tsx`, the `mb-4 flex items-center gap-3` block at ~line 335, alongside Edit/History), rendered only when `isOwner`. Clicking opens a small confirmation modal (reuse `Card`/`Button`; `variant="danger"`) — "Delete this document? This permanently removes it and all its comments, versions, and reviews. This can't be undone." On confirm: `fetch(DELETE)` → on `ok`, `router.push("/app")` (the document list). No "type the title" friction — it's the owner's own document behind an explicit modal.

### Tests
- Service: create a document with versions, annotations (incl. an applied suggestion → exercises `appliedInVersion`), comments, and a review; `deleteDocument` succeeds and leaves no orphan rows. This is the regression guard for the `Restrict` FKs.
- Route: owner → 200 + gone; non-owner participant → 403; non-participant → 404; unauthenticated → 401.
- e2e (optional, light): owner sees Delete, confirms, lands on `/app` without the document.

## Out of scope
Admin/moderator delete · soft-delete/trash/recovery · bulk delete · quorum thresholds · undo. All → M5+.

## Files touched
- `app/api/documents/[id]/reviews/route.ts` (owner 403)
- `app/api/documents/[id]/route.ts` (DELETE handler)
- `lib/documents.ts` (`deleteDocument`)
- `components/DocumentView.tsx` (hide verdict controls for owner; Delete button + confirm modal)
- tests: reviews owner-block, delete service cascade, delete route authz.
