# ADR-Security-000: Generic OIDC SSO alongside email+password

## Status

Accepted

## Date

2026-06-07

## Context

Quorum AI authenticates users with email+password only, via better-auth's
`emailAndPassword` provider (`lib/auth.ts`). Teams that run their own identity
provider (Keycloak, Authentik, Azure AD, Auth0) cannot bring their existing
identities, and there is no single-sign-on story. SSO was the most-requested
deferred item from the M2 roadmap and is the goal of milestone M3 / phase P6.

Three constraints shape the decision:

1. **One generic provider, not named social buttons.** Quorum's audience is
   teams with a corporate IdP, not consumers signing in with Google/GitHub. A
   single env-configured OIDC provider covers every standards-compliant IdP.
2. **Additive, zero-burden default.** The default deployment must remain
   password-only with no new required configuration — the SSO provider should
   not even be registered unless explicitly configured, mirroring how the SMTP
   integration is gated.
3. **No schema change.** better-auth's existing `Account` model already stores
   `providerId`, `idToken`, `accessToken`, `refreshToken`, and `scope` with a
   `@@unique([accountId, providerId])` constraint — everything OIDC linking
   needs.

The hard problem is **account linking**. When someone signs in via SSO with an
email that already belongs to a local password account, do we link the two or
create a duplicate? better-auth's linking logic
(`better-auth@1.6.14`, `dist/oauth2/link-account.mjs`) blocks auto-linking
unless **both** of these hold:

- The OIDC provider is trusted **or** the IdP marks the email verified; and
- `account.accountLinking.requireLocalEmailVerified` (default `true`) is
  satisfied — i.e. the **existing local** user's email is also verified.

Quorum has **no email-verification flow**: password signup creates users with
`emailVerified=false` and nothing ever flips it true. So under better-auth's
defaults the second condition is *never* satisfied, auto-linking *never* fires,
and a colliding-email SSO sign-in fails with a hard `"account not linked"`
error — which would make SSO unusable for anyone who already has a password
account. Relaxing `requireLocalEmailVerified` to `false` fixes that, but because
self-service registration is open (`app/register`), it reopens a
pre-registration account-takeover vector: an attacker registers an unverified
`victim@corp.com`, and the real victim's later SSO login links the IdP identity
into the attacker-seeded, password-holding account.

## Decision

We will add **one generic OIDC provider** via better-auth's `genericOAuth`
plugin, alongside the existing email+password provider, with the following
policy:

1. **Env-gated registration.** The provider is added to the better-auth config
   only when `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET` are all
   set. The login button is rendered only when the public flag
   `NEXT_PUBLIC_OIDC_ENABLED` is set. Unconfigured = password-only, no provider
   registered, no button.

2. **Link by IdP-verified email.** We set
   `account.accountLinking.requireLocalEmailVerified: false` and keep `"oidc"`
   **out of `trustedProviders`**. The net effect: linking happens if and only if
   the **IdP** marks the email verified. An IdP-verified email matching an
   existing user links a new `Account{providerId:"oidc"}` row to that user; an
   unmatched email creates a new user with the default `member` role; an
   unverified IdP email is refused linking.

3. **Disable self-service password signup under SSO.** When OIDC is configured,
   `emailAndPassword.disableSignUp` is set to `true` and the `/register` page is
   guarded. This closes the pre-registration takeover vector — under SSO,
   identity provisioning belongs to the IdP. Password **login** for existing
   accounts is unaffected. Default (non-OIDC) deployments keep open signup.

No `prisma/schema.prisma` change is required.

## Rationale

The generic `genericOAuth` plugin (not the `oidc-provider` plugin, which makes
better-auth *be* an IdP) is the smallest surface that satisfies "any
standards-compliant IdP." Discovery via `${OIDC_ISSUER}/.well-known/openid-configuration`
with `scopes: ["openid","email","profile"]` and PKCE is the conventional,
secure configuration.

The linking policy is the crux. The two literal goals from the design — "link an
existing user by verified email" (D4) and "never link on an unverified email,
to avoid takeover" (D5) — are in direct tension under better-auth's model *given
Quorum's lack of local email verification*. We resolve it by separating the two
verification checks better-auth conflates:

- **IdP-side verification stays mandatory** (provider untrusted → IdP must mark
  the email verified). This is the real anti-takeover guarantee: the IdP is the
  authority on whether the user owns that email.
- **Local-side verification is dropped** (`requireLocalEmailVerified:false`)
  because Quorum never produces a verified local email, so requiring it would
  permanently disable linking rather than add safety.

Dropping local verification alone would be unsafe with open registration, so we
pair it with disabling self-service signup whenever SSO is active. In an SSO
deployment, letting anyone self-register a password account is exactly the
attack surface; removing it is both the security fix and the architecturally
honest posture (the IdP owns provisioning). Keeping the gate conditional on
`oidcConfigured` means non-SSO deployments are completely unaffected.

### Alternatives Considered

**Keep better-auth defaults (`requireLocalEmailVerified:true`, no signup change)**

- Pro: No takeover vector; zero new policy to reason about.
- Con: Auto-linking never fires (no local email is ever verified), so any SSO
  sign-in with an email that collides with an existing account hard-errors with
  `"account not linked"`. SSO is effectively broken for existing users. Fails
  the core phase goal.

**`requireLocalEmailVerified:false` with no signup mitigation**

- Pro: Simplest code change; D4 linking works.
- Con: Reopens pre-registration takeover with open registration. Leaves a real,
  exploitable security hole. Rejected.

**Domain-match block on registration (reject signup for the IdP's email domain)**

- Pro: Preserves mixed password+SSO signup.
- Con: Fragile — issuer host need not equal the email domain, multi-domain IdPs
  and subdomains defeat it, and it doesn't cover non-domain collisions. More
  moving parts than disabling signup, for a weaker guarantee.

**Add a full email-verification flow so local emails can be verified**

- Pro: Would let us keep better-auth's default and link safely.
- Con: Substantial new scope (verification tokens, email templates, UX) well
  beyond P6, and unnecessary once the IdP is the provisioning authority.

**Named social providers (Google/GitHub) instead of generic OIDC**

- Pro: Slightly simpler per-provider config.
- Con: Wrong audience (corporate IdPs, not consumer logins) and doesn't scale to
  arbitrary IdPs. Deferred to M4+ as a non-goal.

## Consequences

### Positive

- Teams can sign in with their existing IdP; first-time SSO users are
  auto-provisioned as `member`.
- Existing password users are seamlessly upgraded to SSO on a matching
  IdP-verified email — no duplicate accounts.
- Default deployments are entirely unchanged: no provider registered, no button,
  open signup intact.
- No database migration; reuses the existing `Account` model.

### Negative

- When OIDC is enabled, self-service password registration is gone — new users
  must come through the IdP (or be created by other means). This is intended but
  is a behavior change operators must understand; documented in
  `.env.example` and the README.
- Two parallel auth paths (password login + SSO) increase the auth surface to
  test and maintain.

### Risks

- **Residual takeover window before signup is disabled.** If a deployment ran
  with open password signup *before* enabling OIDC, an attacker could already
  have pre-registered a victim email; the first SSO login would link into it.
  Mitigation: operators enabling SSO on an existing deployment should audit
  pre-existing accounts. Greenfield SSO deployments are unaffected.
- **IdP `email_verified` trust.** The policy relies on the IdP correctly
  asserting `email_verified`. A misconfigured IdP that marks unverified emails
  as verified would undermine the linking guarantee — standard for any
  SSO-by-email-trust model.
- **No role mapping from IdP claims.** All SSO users get `member`; elevating
  roles remains manual. Acceptable for P6; revisit if IdP-driven roles are
  needed (M4+).
