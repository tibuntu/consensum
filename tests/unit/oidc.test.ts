import { describe, it, expect } from "vitest";
import { isOidcConfigured, oidcDiscoveryUrl, oidcPlugins, OIDC_PROVIDER_ID } from "@/lib/oidc";

const fullEnv = {
  OIDC_ISSUER: "https://idp.example.com/realms/quorum/",
  OIDC_CLIENT_ID: "quorum",
  OIDC_CLIENT_SECRET: "shhh",
} as unknown as NodeJS.ProcessEnv;

describe("isOidcConfigured", () => {
  it("is true only when all three vars are set", () => {
    expect(isOidcConfigured(fullEnv)).toBe(true);
    expect(isOidcConfigured({ ...fullEnv, OIDC_CLIENT_SECRET: "" })).toBe(false);
    expect(isOidcConfigured({ OIDC_ISSUER: "https://x" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isOidcConfigured({} as unknown as NodeJS.ProcessEnv)).toBe(false);
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
    expect(oidcPlugins({} as unknown as NodeJS.ProcessEnv)).toEqual([]);
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
