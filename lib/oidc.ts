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
