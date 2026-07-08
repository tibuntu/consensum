import { describe, it, expect } from "vitest";
import { adminEmails, isAdmin } from "@/lib/admin";

const env = (ADMIN_EMAILS?: string): NodeJS.ProcessEnv =>
  ({ ADMIN_EMAILS }) as unknown as NodeJS.ProcessEnv;

describe("adminEmails", () => {
  it("returns [] when unset or empty", () => {
    expect(adminEmails(env())).toEqual([]);
    expect(adminEmails(env(" , ,"))).toEqual([]);
  });
  it("trims, lowercases, drops empties", () => {
    expect(adminEmails(env(" Alice@Corp.com , BOB@x.io "))).toEqual(["alice@corp.com", "bob@x.io"]);
  });
});

describe("isAdmin", () => {
  it("is true for an env-listed email regardless of role", () => {
    expect(isAdmin({ email: "alice@corp.com", role: "member" }, env("alice@corp.com"))).toBe(true);
  });
  it("is true for role admin regardless of env", () => {
    expect(isAdmin({ email: "x@y.io", role: "admin" }, env())).toBe(true);
  });
  it("is false for a plain member not in env", () => {
    expect(isAdmin({ email: "x@y.io", role: "member" }, env("alice@corp.com"))).toBe(false);
  });
  it("matches env email case-insensitively", () => {
    expect(isAdmin({ email: "Alice@Corp.com", role: null }, env("alice@corp.com"))).toBe(true);
  });
});
