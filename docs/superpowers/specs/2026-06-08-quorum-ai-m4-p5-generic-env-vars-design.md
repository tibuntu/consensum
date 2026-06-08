# M4 · P5 — Generic Env Vars (design)

> Phase spec for M4 P5. Parent roadmap: `specs/2026-06-08-quorum-ai-m4-roadmap.md`.
> Rename library-specific auth env vars to framework-agnostic names.

## Problem

Two operator-facing env vars carry better-auth's library naming, leaking an implementation detail into deployment config:
- `BETTER_AUTH_URL` — the app's public origin (used for trusted origins, email links, machine-API base URL display).
- `BETTER_AUTH_SECRET` — the signing secret.

These should be generic: **`BASE_URL`** and **`AUTH_SECRET`**.

## Decisions (locked)

- **Hard rename** (breaking): the old names stop working. Existing deploys/compose/CI must set the new names.
- `BETTER_AUTH_URL` → **`BASE_URL`**; `BETTER_AUTH_SECRET` → **`AUTH_SECRET`**.
- While here, **DRY the base-URL reads** behind a single `baseUrl()` helper.

## Key constraint

`BETTER_AUTH_*` are **better-auth convention names** that the library auto-reads. Today `lib/auth.ts` does **not** pass `secret`/`baseURL` explicitly — it relies on that convention for the secret, and reads `BETTER_AUTH_URL` only to build `trustedOrigins`. A hard rename therefore **requires wiring the new names into `betterAuth()` explicitly**, or auth breaks at boot.

## Design

### `lib/auth.ts`
- Pass the secret and base URL explicitly into `betterAuth({...})`:

```ts
export const auth = betterAuth({
  // ...existing config...
  secret: process.env.AUTH_SECRET,
  baseURL: process.env.BASE_URL,
  trustedOrigins,
  // ...
});
```

- Build `trustedOrigins` from `BASE_URL` (replace the `process.env.BETTER_AUTH_URL` read):

```ts
const trustedOrigins = [
  process.env.BASE_URL,
  ...(process.env.TRUSTED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
].filter(Boolean) as string[];
```

### `lib/config.ts` — add `baseUrl()` helper (DRY)
There are four ad-hoc reads of `BETTER_AUTH_URL` with inconsistent fallbacks. Centralize:

```ts
/** The app's public origin, e.g. https://quorum.example. Falls back to localhost in dev. */
export function baseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.BASE_URL ?? "http://localhost:3000";
}
```

Route these through `baseUrl()`:
- `lib/email-templates.ts:10` (`baseUrl()` local helper → use the shared one; consistent fallback)
- `app/api/plans/route.ts:15` (`const base = baseUrl();`)
- `app/app/settings/tokens/page.tsx` (the `baseUrl={...}` prop passed to `TokenManager`)
- `lib/auth.ts` keeps reading `process.env.BASE_URL` directly for `baseURL`/`trustedOrigins` (it needs the raw value incl. possibly-undefined for better-auth, not the localhost fallback).

### Config/docs updates (all references)
- `.env.example`: rename the two vars + comments (keep the `# Extra CSRF-trusted origins beyond BASE_URL` wording).
- `docker-compose.yml:8` (and the env passthrough) → `AUTH_SECRET`, `BASE_URL`.
- `.github/workflows/ci.yml:17,38` → new names.
- `README.md`: every mention of the old vars (quickstart, container run, deploy docs) → new names; note the breaking rename in the M4/upgrade notes.
- `Dockerfile`: if it references either var, update; otherwise no change (it doesn't set them — they're runtime env).

## Tests
- `tests/unit/config.baseurl.test.ts`: `baseUrl({ BASE_URL: "https://q.example" })` → that value; `baseUrl({})` → `http://localhost:3000`.
- `tests/unit/email-templates.test.ts`: switch the stubbed `BETTER_AUTH_URL` to `BASE_URL`.
- Full suite + `tsc` + lint green; a grep for `BETTER_AUTH_` returns zero hits in tracked files after the change.

## Out of scope
A full centralized/zod-validated env module · renaming unrelated vars (DATABASE_URL, OIDC_*, SMTP_*, OUTBOX_*) · backward-compat aliases for the old names (explicitly a hard rename). → M5+ if desired.

## Files touched
- `lib/auth.ts` (explicit `secret`/`baseURL`; trustedOrigins from BASE_URL)
- `lib/config.ts` (`baseUrl()` helper)
- `lib/email-templates.ts`, `app/api/plans/route.ts`, `app/app/settings/tokens/page.tsx` (use `baseUrl()`)
- `.env.example`, `docker-compose.yml`, `.github/workflows/ci.yml`, `README.md` (rename)
- tests: `config.baseurl.test.ts`, `email-templates.test.ts`
