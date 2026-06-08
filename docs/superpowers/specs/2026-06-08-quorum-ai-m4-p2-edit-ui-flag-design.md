# M4 · P2 — Edit-UI Feature Flag (design)

> Phase spec for M4 P2. Parent roadmap: `specs/2026-06-08-quorum-ai-m4-roadmap.md`.
> Gate the human document-editing UI behind an env flag. UI-only; the edit API stays functional for machine/API callers.

## Problem

Quorum AI plans are agent-driven. The UI exposes a human **Edit** button unconditionally (`components/DocumentView.tsx:337`). Some operators want a deployment where humans review and comment but do **not** hand-edit the plan in the browser — editing belongs to the agent. There is no switch for this today.

## Decisions (locked)

- **Gate the UI only, default ON.** When the flag is off, the in-app edit affordance is hidden; the `PATCH /api/documents/[id]` route stays fully functional (machine/API callers, and the agent loop, are unaffected). Default is ON so current behavior is unchanged — operators opt out.
- Env var read **server-side** and passed as a prop (like `isOwner`). **Not** `NEXT_PUBLIC_` — keeps it out of the client bundle and avoids the "public flag set without server intent" footgun called out for OIDC in `.env.example`.

## Design

### Config helper — `lib/config.ts` (new)
Follows the `isEmailConfigured()` / `isOidcConfigured()` shape (`lib/email.ts:9`, `lib/oidc.ts:7`), defaulting to enabled:

```ts
export function isEditUiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  // Default ON; operators opt out with EDIT_UI_ENABLED=false (case-insensitive).
  return env.EDIT_UI_ENABLED?.toLowerCase() !== "false";
}
```

The `env` param (matching `isOidcConfigured`) makes it unit-testable without mutating `process.env`.

### Server → client prop flow
`app/app/documents/[id]/page.tsx`:
- import `isEditUiEnabled` from `@/lib/config`
- compute `const editEnabled = isEditUiEnabled();` (near the `isOwner` computation, ~line 37)
- pass `<DocumentView doc={serializable} isOwner={isOwner} editEnabled={editEnabled} />`

### DocumentView
- Extend props: `{ doc, isOwner, editEnabled }: { doc: ClientDocument; isOwner: boolean; editEnabled: boolean }` (line 64).
- Gate the Edit button (line 337): `{mode === "review" && editEnabled && (<Button ...>Edit</Button>)}`.
- If the editor mode can otherwise be reached, ensure it can't when `editEnabled` is false (the Edit button is the only entry point — confirm in the plan; no other `setMode("edit")` trigger should remain reachable).

### Docs
`.env.example` — add after the OIDC block (~line 46), matching the existing commented style:

```
# Document editing UI (optional). Default: enabled.
# Set to "false" to hide the in-app Edit button (plans stay agent-driven via the API).
# The PATCH /api/documents/[id] edit endpoint is NOT gated — only the UI.
EDIT_UI_ENABLED=
```

README — one line in the env/config section noting `EDIT_UI_ENABLED` and that it's UI-only.

### Tests
- Unit: `isEditUiEnabled` — unset → true; `"false"`/`"FALSE"` → false; `"true"`/other → true.
- Component/e2e (light): with the flag off, the Edit button is absent for an owner; with it on (default), present. Reuse the existing `data-testid`/button-name hooks; do not rename them.

## Out of scope
Gating the edit API for machine callers · a read-only banner/explainer · per-document or per-role edit permissions · runtime (non-env) toggling. All → M5+ if ever.

## Files touched
- `lib/config.ts` (new — `isEditUiEnabled`)
- `app/app/documents/[id]/page.tsx` (compute + pass `editEnabled`)
- `components/DocumentView.tsx` (accept prop; gate Edit button)
- `.env.example`, `README` (document the var)
- tests: `isEditUiEnabled` unit; flag-off hides Edit.
