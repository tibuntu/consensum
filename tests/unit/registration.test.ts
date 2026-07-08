import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { registrationAllowlist, matchesAllowlist, isRegistrationAllowed } from "@/lib/registration";

const env = (REGISTRATION_ALLOWLIST?: string): NodeJS.ProcessEnv =>
  ({ REGISTRATION_ALLOWLIST }) as unknown as NodeJS.ProcessEnv;

describe("registrationAllowlist", () => {
  it("returns [] when unset or empty", () => {
    expect(registrationAllowlist(env())).toEqual([]);
    expect(registrationAllowlist(env(" , ,"))).toEqual([]);
  });
  it("trims, lowercases, strips leading @, drops empties", () => {
    expect(registrationAllowlist(env(" Alice@Corp.com , @Example.ORG ,, corp.com ")))
      .toEqual(["alice@corp.com", "example.org", "corp.com"]);
  });
});

describe("matchesAllowlist", () => {
  it("is fail-closed on an empty set", () => {
    expect(matchesAllowlist("anyone@corp.com", [])).toBe(false);
  });
  it("allows any validly-formed email when '*' is present", () => {
    expect(matchesAllowlist("anyone@anywhere.com", ["*"])).toBe(true);
  });
  it("rejects malformed emails even with '*'", () => {
    expect(matchesAllowlist("not-an-email", ["*"])).toBe(false);
    expect(matchesAllowlist("trailing@", ["*"])).toBe(false);
  });
  it("matches exact email and bare domain, not subdomains", () => {
    expect(matchesAllowlist("Alice@Corp.com", ["alice@corp.com"])).toBe(true);
    expect(matchesAllowlist("bob@corp.com", ["corp.com"])).toBe(true);
    expect(matchesAllowlist("x@mail.corp.com", ["corp.com"])).toBe(false);
  });
});

describe("isRegistrationAllowed (env ∪ DB)", () => {
  const created: string[] = [];
  afterEach(async () => {
    if (created.length) await prisma.registrationAllowlistEntry.deleteMany({ where: { value: { in: created } } });
    created.length = 0;
  });
  async function addEntry(value: string) {
    created.push(value);
    await prisma.registrationAllowlistEntry.create({ data: { value, createdBy: "test" } });
  }

  it("is fail-closed with empty env and empty table", async () => {
    expect(await isRegistrationAllowed("x@nope.com", env())).toBe(false);
  });
  it("allows when only env matches", async () => {
    expect(await isRegistrationAllowed("x@corp.com", env("corp.com"))).toBe(true);
  });
  it("allows when only a DB entry matches", async () => {
    await addEntry("dbonly.com");
    expect(await isRegistrationAllowed("y@dbonly.com", env())).toBe(true);
  });
});
