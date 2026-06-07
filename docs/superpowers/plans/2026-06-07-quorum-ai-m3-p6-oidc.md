# M3/P6 Generic OIDC Login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one env-gated generic OIDC provider to Quorum's better-auth setup alongside email+password, linking accounts by IdP-verified email and disabling self-service password signup when SSO is active.

**Architecture:** A pure helper module (`lib/oidc.ts`) owns the gating decision and builds the `genericOAuth` plugin from env, so the policy is unit-testable without booting better-auth. `lib/auth.ts` consumes it and sets the account-linking policy (`requireLocalEmailVerified:false`, provider untrusted) and `disableSignUp` gate. The client plugin + a conditionally-rendered "Sign in with SSO" button complete the flow. No Prisma schema change — the existing `Account` model already stores OAuth tokens.

**Tech Stack:** Next.js (App Router), better-auth@1.6.14 (`genericOAuth` / `genericOAuthClient`), Prisma + SQLite, Vitest (unit), Playwright (e2e).

**Reference:** Spec `docs/superpowers/specs/2026-06-06-quorum-ai-m3-p6-oidc-design.md`; decision record `docs/adr/ADR-Security-000-generic-oidc-sso-alongside-password.md`.

**Verified facts (better-auth@1.6.14 source):**
- `genericOAuth` is imported from `better-auth/plugins`; `genericOAuthClient` from `better-auth/client/plugins` (both confirmed to resolve as functions).
- Linking (`dist/oauth2/link-account.mjs`) blocks auto-link unless `(isTrustedProvider || oidcEmailVerified)` AND `(!requireLocalEmailVerified || localEmailVerified)`. Quorum never verifies local email → `requireLocalEmailVerified` MUST be `false`, and provider MUST stay out of `trustedProviders` so the IdP-verified-email check still applies.
- `auth.options` exposes `account.accountLinking`, `emailAndPassword`, and `plugins` (each plugin has an `id`; `genericOAuth`'s id is `"generic-oauth"`) — so config is assertable in unit tests.
- `signIn.oauth2` accepts `{ providerId, callbackURL?, errorCallbackURL?, newUserCallbackURL?, scopes?, requestSignUp? }`.
- Login success redirects to `/app` (see `app/login/page.tsx`).
- `prisma` is a `globalThis` singleton (`lib/db.ts`), safe to re-import under `vi.resetModules()`.

---

### Task 1: `lib/oidc.ts` — pure gating + provider builder

**Goal:** A dependency-light module that decides whether OIDC is configured and builds the `genericOAuth` plugin, fully unit-testable from a plain env object.

**Files:**
- Create: `lib/oidc.ts`
- Test: `tests/unit/oidc.test.ts`

**Acceptance Criteria:**
- [ ] `isOidcConfigured(env)` returns `true` only when all three of `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` are non-empty.
- [ ] `oidcDiscoveryUrl(issuer)` appends `/.well-known/openid-configuration` and strips any trailing slash(es) from the issuer.
- [ ] `oidcPlugins(env)` returns `[]` when not configured, and a one-element array (a `genericOAuth` plugin with `id === "generic-oauth"`) when configured.
- [ ] The built provider config uses `providerId: "oidc"`, `scopes: ["openid","email","profile"]`, `pkce: true`, and wires `clientId`/`clientSecret`/`discoveryUrl` from env.

**Verify:** `pnpm vitest run tests/unit/oidc.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test** — `tests/unit/oidc.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { isOidcConfigured, oidcDiscoveryUrl, oidcPlugins, OIDC_PROVIDER_ID } from "@/lib/oidc";

const fullEnv = {
  OIDC_ISSUER: "https://idp.example.com/realms/quorum/",
  OIDC_CLIENT_ID: "quorum",
  OIDC_CLIENT_SECRET: "shhh",
} as NodeJS.ProcessEnv;

describe("isOidcConfigured", () => {
  it("is true only when all three vars are set", () => {
    expect(isOidcConfigured(fullEnv)).toBe(true);
    expect(isOidcConfigured({ ...fullEnv, OIDC_CLIENT_SECRET: "" })).toBe(false);
    expect(isOidcConfigured({ OIDC_ISSUER: "https://x" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isOidcConfigured({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("oidcDiscoveryUrl", () => {
  it("strips trailing slashes and appends the well-known path", () => {
    expect(oidcDiscoveryUrl("https://idp.example.com/realms/quorum/")).toBe(
      "https://idp.example.com/realms/quorum/.well-known/openid-configuration",
    );
    expect(oidcDiscoveryUrl("https://idp.example.com")).toBe(
      "https://idp.example.com/.well-known/openid-configuration",
    );
  });
});

describe("oidcPlugins", () => {
  it("returns [] when unconfigured", () => {
    expect(oidcPlugins({} as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("returns one generic-oauth plugin when configured", () => {
    const plugins = oidcPlugins(fullEnv);
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.id).toBe("generic-oauth");
  });

  it("exposes a stable provider id", () => {
    expect(OIDC_PROVIDER_ID).toBe("oidc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/oidc.test.ts`
Expected: FAIL — `Cannot find module '@/lib/oidc'`.

- [ ] **Step 3: Write minimal implementation** — `lib/oidc.ts`

```ts
import { genericOAuth } from "better-auth/plugins";

/** Provider id used for the generic OIDC provider's Account rows and sign-in calls. */
export const OIDC_PROVIDER_ID = "oidc";

/** True only when all three OIDC env vars are present and non-empty. */
export function isOidcConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET);
}

/** Build the OIDC discovery document URL from the issuer (trailing slashes stripped). */
export function oidcDiscoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
}

/**
 * The generic OIDC plugin, gated on configuration. Returns `[]` (no provider
 * registered) when the env is unset, so the default deploy stays password-only.
 *
 * The provider is intentionally NOT added to `trustedProviders` (see lib/auth.ts):
 * that keeps better-auth's "IdP email must be verified to link" guarantee.
 */
export function oidcPlugins(env: NodeJS.ProcessEnv = process.env) {
  if (!isOidcConfigured(env)) return [];
  return [
    genericOAuth({
      config: [
        {
          providerId: OIDC_PROVIDER_ID,
          discoveryUrl: oidcDiscoveryUrl(env.OIDC_ISSUER!),
          clientId: env.OIDC_CLIENT_ID!,
          clientSecret: env.OIDC_CLIENT_SECRET!,
          scopes: ["openid", "email", "profile"],
          pkce: true,
        },
      ],
    }),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/oidc.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
rtk git add lib/oidc.ts tests/unit/oidc.test.ts
rtk git commit -m "feat(oidc): env-gated generic OIDC provider builder"
```

---

### Task 2: Wire OIDC into `lib/auth.ts` — linking policy + signup gate

**Goal:** Register the OIDC provider conditionally, set the account-linking policy that makes link-by-IdP-verified-email work for Quorum's unverified local users, and disable self-service signup when SSO is active.

**Files:**
- Modify: `lib/auth.ts`
- Test: `tests/unit/auth-oidc.test.ts`

**Acceptance Criteria:**
- [ ] `auth.options.account.accountLinking` is `{ enabled: true, requireLocalEmailVerified: false }` (the security policy; independent of env).
- [ ] `auth.options.trustedProviders` does not include `"oidc"` (so IdP-verified-email is still required to link).
- [ ] With the OIDC env unset (default CI build), `auth.options.plugins` contains no plugin with `id === "generic-oauth"` and `auth.options.emailAndPassword.disableSignUp` is falsy.
- [ ] With the OIDC env set (fresh import), `auth.options.plugins` contains a `"generic-oauth"` plugin and `auth.options.emailAndPassword.disableSignUp === true`.
- [ ] With the OIDC env set, `auth.api.signUpEmail(...)` rejects (signup disabled) — proves D5a is enforced server-side, not just in the UI.

**Verify:** `pnpm vitest run tests/unit/auth-oidc.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test** — `tests/unit/auth-oidc.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Helper: re-import lib/auth with a fresh module registry so module-level
// env reads (oidcConfigured) re-evaluate. prisma is a globalThis singleton,
// so re-import reuses the same client.
async function freshAuth() {
  vi.resetModules();
  return (await import("@/lib/auth")).auth;
}

describe("auth account-linking policy (env-independent)", () => {
  it("links by IdP-verified email, not local-verified email", async () => {
    const auth = await freshAuth();
    expect(auth.options.account?.accountLinking).toMatchObject({
      enabled: true,
      requireLocalEmailVerified: false,
    });
  });

  it("does not trust the oidc provider (IdP email must be verified to link)", async () => {
    const auth = await freshAuth();
    expect(auth.options.trustedProviders ?? []).not.toContain("oidc");
  });
});

describe("OIDC gating", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("registers no OIDC provider and keeps signup open by default", async () => {
    vi.stubEnv("OIDC_ISSUER", "");
    vi.stubEnv("OIDC_CLIENT_ID", "");
    vi.stubEnv("OIDC_CLIENT_SECRET", "");
    const auth = await freshAuth();
    expect(auth.options.plugins?.some((p) => p.id === "generic-oauth")).toBe(false);
    expect(auth.options.emailAndPassword?.disableSignUp).toBeFalsy();
  });

  it("registers the OIDC provider and disables signup when configured", async () => {
    vi.stubEnv("OIDC_ISSUER", "https://idp.example.com");
    vi.stubEnv("OIDC_CLIENT_ID", "quorum");
    vi.stubEnv("OIDC_CLIENT_SECRET", "shhh");
    const auth = await freshAuth();
    expect(auth.options.plugins?.some((p) => p.id === "generic-oauth")).toBe(true);
    expect(auth.options.emailAndPassword?.disableSignUp).toBe(true);
  });

  it("rejects self-service signup when OIDC is configured (D5a, server-side)", async () => {
    vi.stubEnv("OIDC_ISSUER", "https://idp.example.com");
    vi.stubEnv("OIDC_CLIENT_ID", "quorum");
    vi.stubEnv("OIDC_CLIENT_SECRET", "shhh");
    const auth = await freshAuth();
    await expect(
      auth.api.signUpEmail({
        body: { email: `gate-${Date.now()}@example.com`, password: "correct-horse-battery", name: "Gate" },
      }),
    ).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/auth-oidc.test.ts`
Expected: FAIL — `accountLinking` undefined / no `disableSignUp` / signup not rejected.

- [ ] **Step 3: Write minimal implementation** — edit `lib/auth.ts`

Add the import near the top (after the existing imports):

```ts
import { isOidcConfigured, oidcPlugins } from "@/lib/oidc";
```

Add this line after the `trustedOrigins` block:

```ts
const oidcConfigured = isOidcConfigured();
```

Change `emailAndPassword` and add the `account` block, and prepend OIDC plugins (keeping `nextCookies()` last):

```ts
  // Self-service password signup is disabled under SSO so an attacker can't
  // pre-register an unverified email that a later OIDC sign-in would link into
  // (ADR-Security-000, D5a). Password LOGIN for existing users is unaffected.
  emailAndPassword: { enabled: true, disableSignUp: oidcConfigured },
  account: {
    accountLinking: {
      // Link an OIDC identity to an existing user on a matching email. Quorum
      // has no local email-verification flow, so requireLocalEmailVerified must
      // be false or linking would never fire. Safety comes from the IdP side:
      // "oidc" is intentionally NOT in trustedProviders, so better-auth still
      // requires the IdP to mark the email verified before linking
      // (ADR-Security-000, D4/D5).
      enabled: true,
      requireLocalEmailVerified: false,
    },
  },
```

```ts
  plugins: [...oidcPlugins(), nextCookies()],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/auth-oidc.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression — full unit suite + typecheck**

Run: `pnpm vitest run tests/unit/auth.test.ts tests/unit/oidc.test.ts tests/unit/auth-oidc.test.ts && rtk tsc --noEmit`
Expected: existing email signup/login test still passes; typecheck clean.

- [ ] **Step 6: Commit**

```bash
rtk git add lib/auth.ts tests/unit/auth-oidc.test.ts
rtk git commit -m "feat(oidc): register provider + link-by-verified-email policy + signup gate"
```

---

### Task 3: Client plugin + "Sign in with SSO" button

**Goal:** Expose `signIn.oauth2` via the client plugin and render an SSO button on the login page when `NEXT_PUBLIC_OIDC_ENABLED` is set.

**Files:**
- Modify: `lib/auth-client.ts`
- Modify: `app/login/page.tsx`

**Acceptance Criteria:**
- [ ] `authClient` is created with `genericOAuthClient()`, so `signIn.oauth2` is available.
- [ ] The login page renders a "Sign in with SSO" button only when `process.env.NEXT_PUBLIC_OIDC_ENABLED === "true"`.
- [ ] The button calls `signIn.oauth2({ providerId: "oidc", callbackURL: "/app", errorCallbackURL: "/login?error=sso" })`.
- [ ] Password login is unchanged.

**Verify:** `rtk tsc --noEmit` clean, and `pnpm build` succeeds. (Visibility behavior is covered by the e2e default-state spec in Task 5; full SSO round-trip needs a real IdP — see Task 5 note.)

**Steps:**

- [ ] **Step 1: Update `lib/auth-client.ts`**

```ts
"use client";
import { createAuthClient } from "better-auth/react";
import { genericOAuthClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [genericOAuthClient()],
});
export const { signIn, signUp, signOut, useSession } = authClient;
```

- [ ] **Step 2: Add the SSO button to `app/login/page.tsx`**

Add a handler inside the component (after `onSubmit`):

```tsx
  const oidcEnabled = process.env.NEXT_PUBLIC_OIDC_ENABLED === "true";

  async function onSso() {
    await signIn.oauth2({
      providerId: "oidc",
      callbackURL: "/app",
      errorCallbackURL: "/login?error=sso",
    });
  }
```

Render the button between the password `<Button type="submit">Log in</Button>` and the `<Link href="/register">`:

```tsx
        <Button type="submit">Log in</Button>
        {oidcEnabled && (
          <Button type="button" variant="secondary" onClick={onSso}>
            Sign in with SSO
          </Button>
        )}
        <Link href="/register" className="text-sm text-muted hover:underline">
```

- [ ] **Step 3: Verify build + typecheck**

Run: `rtk tsc --noEmit && pnpm build`
Expected: clean typecheck; build succeeds (default build has no `NEXT_PUBLIC_OIDC_ENABLED`, so the button is compiled out of the rendered output).

- [ ] **Step 4: Commit**

```bash
rtk git add lib/auth-client.ts app/login/page.tsx
rtk git commit -m "feat(oidc): client plugin + conditional Sign in with SSO button"
```

---

### Task 4: Guard `app/register/page.tsx` under SSO

**Goal:** When SSO is active, the self-service registration page stops offering the password-signup form and points users at SSO login — mirroring the server-side `disableSignUp` gate (D5a).

**Files:**
- Modify: `app/register/page.tsx`

**Acceptance Criteria:**
- [ ] When `process.env.NEXT_PUBLIC_OIDC_ENABLED === "true"`, the register page renders a short "signup is via SSO" notice with a link to `/login` and does NOT render the email/password form.
- [ ] When the flag is unset (default), the existing registration form renders unchanged.

**Verify:** `rtk tsc --noEmit` clean, `pnpm build` succeeds. (Behavior covered by Task 5 default-state e2e.)

**Steps:**

- [ ] **Step 1: Add the guard to `app/register/page.tsx`**

Add near the top of the component body (after the `useState` hooks):

```tsx
  const oidcEnabled = process.env.NEXT_PUBLIC_OIDC_ENABLED === "true";
```

Then, immediately before the existing `return (`, add an early return:

```tsx
  if (oidcEnabled) {
    return (
      <Card className="mx-auto mt-24 max-w-sm p-6">
        <div className="flex flex-col gap-3">
          <span className="text-sm font-semibold text-primary">◆ Quorum</span>
          <h1 className="text-xl font-semibold text-foreground">Sign-up is via SSO</h1>
          <p className="text-sm text-muted">
            This workspace uses single sign-on. Create your account by signing in
            with your identity provider.
          </p>
          <Link href="/login" className="text-sm text-muted hover:underline">
            Go to <span className="font-medium text-primary">Log in</span>
          </Link>
        </div>
      </Card>
    );
  }
```

(`Card` and `Link` are already imported in this file.)

- [ ] **Step 2: Verify build + typecheck**

Run: `rtk tsc --noEmit && pnpm build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
rtk git add app/register/page.tsx
rtk git commit -m "feat(oidc): guard self-service register page under SSO"
```

---

### Task 5: e2e default-state regression spec

**Goal:** Lock the default (no-OIDC) deployment behavior: SSO button hidden, password login still works, register form present. This is what CI builds, so it's the coverage we can run hermetically.

**Files:**
- Create: `tests/e2e/oidc.spec.ts`

**Acceptance Criteria:**
- [ ] On `/login` with no OIDC env, there is NO "Sign in with SSO" button, and the password form (email + password inputs, "Log in") is present.
- [ ] On `/register` with no OIDC env, the registration form (name/email/password + "Sign up") is present (not the SSO notice).
- [ ] The spec documents, in a top-of-file comment, that the OIDC-enabled flow (button visible + full sign-in via a mock IdP) is verified separately — see the note below — so this gap is explicit, not silent.

**Verify:** `pnpm playwright test tests/e2e/oidc.spec.ts` → pass (default build, no OIDC env).

> **Coverage note (no silent cap):** `NEXT_PUBLIC_OIDC_ENABLED` and the `OIDC_*` server vars are read at build/boot time, and the Playwright `webServer` builds once with the ambient (no-OIDC) env. Exercising the *enabled* path (visible SSO button + full authorization-code round-trip) requires a second build with the env set plus a mock OIDC IdP (discovery doc, authorize redirect, token + userinfo endpoints, PKCE). That is disproportionate for P6 and is **explicitly deferred** — the config, gating, and server-side signup-disable are fully covered by the Task 1–2 unit tests, which is where our code's logic lives. Linking *behavior* itself is better-auth's code, not ours. To verify the enabled path manually: set the four env vars against a real IdP (e.g. Keycloak), `pnpm build && pnpm start`, confirm the SSO button appears, sign in, and confirm a `member` user + session is created.

**Steps:**

- [ ] **Step 1: Write the spec** — `tests/e2e/oidc.spec.ts`

```ts
// Default-state (no-OIDC) regression coverage. The Playwright webServer builds
// once with the ambient env, which has no OIDC_* / NEXT_PUBLIC_OIDC_ENABLED set,
// so these tests assert the password-only default. The OIDC-ENABLED path (visible
// SSO button + full sign-in via a mock IdP) is deferred — see the plan's Task 5
// coverage note. Config/gating/signup-disable are covered by the unit suite.
import { test, expect } from "@playwright/test";

test("login page has no SSO button by default; password form present", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /sign in with sso/i })).toHaveCount(0);
  await expect(page.getByLabel("email")).toBeVisible();
  await expect(page.getByLabel("password")).toBeVisible();
  await expect(page.getByRole("button", { name: /^log in$/i })).toBeVisible();
});

test("register page shows the signup form by default (not the SSO notice)", async ({ page }) => {
  await page.goto("/register");
  await expect(page.getByLabel("name")).toBeVisible();
  await expect(page.getByRole("button", { name: /^sign up$/i })).toBeVisible();
  await expect(page.getByText(/sign-up is via sso/i)).toHaveCount(0);
});
```

- [ ] **Step 2: Run the spec**

Run: `pnpm playwright test tests/e2e/oidc.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
rtk git add tests/e2e/oidc.spec.ts
rtk git commit -m "test(oidc): e2e default-state regression (SSO hidden, password intact)"
```

---

### Task 6: Documentation — `.env.example` + README

**Goal:** Document the optional SSO configuration and its signup-disable side effect.

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

**Acceptance Criteria:**
- [ ] `.env.example` gains the four OIDC vars with a comment that unset = password-only and that setting them disables self-service password signup.
- [ ] `README.md` has a short "Single sign-on (optional OIDC)" section: the four vars, that `NEXT_PUBLIC_OIDC_ENABLED=true` must accompany the server vars, linking-by-IdP-verified-email behavior, and the signup-disabled-under-SSO note. Links to ADR-Security-000.

**Verify:** `grep -q OIDC_ISSUER .env.example && grep -qi "single sign-on" README.md` → exit 0.

**Steps:**

- [ ] **Step 1: Append to `.env.example`**

```
# Optional SSO (generic OIDC). Unset = password-only login.
# When all three are set, self-service password signup is disabled (existing
# password LOGIN still works); set NEXT_PUBLIC_OIDC_ENABLED=true to show the button.
OIDC_ISSUER=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
NEXT_PUBLIC_OIDC_ENABLED=
```

- [ ] **Step 2: Add a README section**

```markdown
## Single sign-on (optional OIDC)

Quorum supports one generic OIDC provider (Keycloak, Authentik, Azure AD, Auth0,
…) alongside email+password. It is off by default. To enable it, set:

| Variable | Purpose |
|----------|---------|
| `OIDC_ISSUER` | Issuer URL; discovery is fetched from `<issuer>/.well-known/openid-configuration` |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | OAuth client credentials from your IdP |
| `NEXT_PUBLIC_OIDC_ENABLED` | Set to `true` to render the "Sign in with SSO" button |

Configure your IdP's redirect URI to `<BETTER_AUTH_URL>/api/auth/oauth2/callback/oidc`.

**Account linking.** An SSO sign-in whose email the IdP marks *verified* is linked
to an existing user with that email; otherwise a new `member` user is created.

**Signup under SSO.** When OIDC is configured, self-service password registration is
disabled (identity provisioning belongs to the IdP); existing password **login**
still works. See `docs/adr/ADR-Security-000-generic-oidc-sso-alongside-password.md`
for the rationale.
```

(Place it after the existing setup/configuration section; adjust the heading level to match surrounding headings.)

- [ ] **Step 3: Verify**

Run: `grep -q OIDC_ISSUER .env.example && grep -qi "single sign-on" README.md && echo OK`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
rtk git add .env.example README.md
rtk git commit -m "docs(oidc): document optional OIDC SSO config + signup-disable behavior"
```

---

## Final verification

- [ ] `pnpm vitest run` — full unit suite green (new `oidc` + `auth-oidc` specs included).
- [ ] `pnpm playwright test tests/e2e/oidc.spec.ts tests/e2e/auth.spec.ts` — OIDC default-state + existing auth e2e green.
- [ ] `rtk tsc --noEmit` — clean.
- [ ] No `prisma/schema.prisma` diff (no schema change).
- [ ] Rebase the worktree branch onto `main` before opening the PR.
