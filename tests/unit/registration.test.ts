import { describe, it, expect } from "vitest";
import { registrationAllowlist, isRegistrationAllowed } from "@/lib/registration";

const env = (REGISTRATION_ALLOWLIST?: string): NodeJS.ProcessEnv =>
  ({ REGISTRATION_ALLOWLIST }) as unknown as NodeJS.ProcessEnv;

describe("registrationAllowlist", () => {
  it("returns [] when unset or empty", () => {
    expect(registrationAllowlist(env())).toEqual([]);
    expect(registrationAllowlist(env(""))).toEqual([]);
    expect(registrationAllowlist(env(" , ,"))).toEqual([]);
  });

  it("trims, lowercases, strips leading @, drops empties", () => {
    expect(registrationAllowlist(env(" Alice@Corp.com , @Example.ORG ,, corp.com ")))
      .toEqual(["alice@corp.com", "example.org", "corp.com"]);
  });
});

describe("isRegistrationAllowed", () => {
  it("is fail-closed when the allowlist is empty", () => {
    expect(isRegistrationAllowed("anyone@corp.com", env())).toBe(false);
    expect(isRegistrationAllowed("anyone@corp.com", env(""))).toBe(false);
  });

  it("allows any validly-formed email when '*' is present", () => {
    expect(isRegistrationAllowed("anyone@anywhere.com", env("*"))).toBe(true);
    expect(isRegistrationAllowed("someone@gmail.com", env("corp.com, *"))).toBe(true);
  });

  it("rejects malformed emails even with '*'", () => {
    expect(isRegistrationAllowed("not-an-email", env("*"))).toBe(false);
    expect(isRegistrationAllowed("trailing@", env("*"))).toBe(false);
  });

  it("matches an exact email entry (case-insensitive)", () => {
    expect(isRegistrationAllowed("Alice@Corp.com", env("alice@corp.com"))).toBe(true);
    expect(isRegistrationAllowed("bob@corp.com", env("alice@corp.com"))).toBe(false);
  });

  it("matches a bare-domain entry for any address at that domain", () => {
    expect(isRegistrationAllowed("BOB@Corp.com", env("corp.com"))).toBe(true);
    expect(isRegistrationAllowed("eve@other.com", env("corp.com"))).toBe(false);
  });

  it("does not implicitly match subdomains", () => {
    expect(isRegistrationAllowed("x@mail.corp.com", env("corp.com"))).toBe(false);
  });
});
