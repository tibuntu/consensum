import { describe, it, expect, vi, beforeEach } from "vitest";

// Re-import lib/auth with a fresh module registry so module-level env reads
// (oidcConfigured) re-evaluate. prisma is a globalThis singleton, so re-import
// reuses the same client.
async function freshAuth() {
  vi.resetModules();
  return (await import("@/lib/auth")).auth;
}

// Fix A: top-level env-stub isolation — clears any stubs before every test in
// every describe block so OIDC stubs from one test cannot leak into another.
beforeEach(() => {
  vi.unstubAllEnvs();
});

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
    const trustedProviders = (auth.options.account?.accountLinking as { trustedProviders?: string[] } | undefined)?.trustedProviders;
    expect(trustedProviders ?? []).not.toContain("oidc");
  });
});

describe("OIDC gating", () => {
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

  // Fix B: assert on the real disabled-signup rejection shape better-auth throws.
  // better-auth raises an APIError with status "BAD_REQUEST" and message
  // "Email and password sign up is not enabled" — verify that precisely.
  it("rejects self-service signup when OIDC is configured (D5a, server-side)", async () => {
    vi.stubEnv("OIDC_ISSUER", "https://idp.example.com");
    vi.stubEnv("OIDC_CLIENT_ID", "quorum");
    vi.stubEnv("OIDC_CLIENT_SECRET", "shhh");
    const auth = await freshAuth();
    const err = await auth.api
      .signUpEmail({ body: { email: `gate-${Date.now()}@example.com`, password: "correct-horse-battery", name: "Gate" } })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeTruthy();
    // better-auth surfaces a disabled-signup as status "BAD_REQUEST" with a
    // message that explicitly mentions sign-up being disabled — not a generic
    // infra error (which would lack a status or carry a 5xx code).
    const status = (err as { status?: string }).status;
    const message = String((err as { message?: string }).message ?? err);
    expect(status === "BAD_REQUEST" || /sign.?up|disabled/i.test(message)).toBe(true);
  });
});
