import { describe, it, expect } from "vitest";
import { adminEmails, isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";
import {
  listUsers,
  setRole,
  setDisabled,
  normalizeAllowlistValue,
  addAllowlistEntry,
  removeAllowlistEntry,
  listAllowlist,
} from "@/lib/admin";

let seq = 0;
async function makeUser(role = "member", email?: string, createdAt = new Date()) {
  const id = `u-adm-${Date.now()}-${++seq}-${Math.round(Math.random() * 1e6)}`;
  return prisma.user.create({
    data: { id, name: id, email: email ?? `${id}@example.com`, emailVerified: false, role, disabled: false, createdAt, updatedAt: createdAt },
  });
}

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

describe("setRole", () => {
  it("promotes a member to admin", async () => {
    const actor = await makeUser("admin");
    const target = await makeUser("member");
    const res = await setRole(actor.id, target.id, "admin");
    expect(res).toEqual({ ok: true });
    expect((await prisma.user.findUnique({ where: { id: target.id } }))!.role).toBe("admin");
  });
  it("refuses to modify self", async () => {
    const actor = await makeUser("admin");
    expect(await setRole(actor.id, actor.id, "member")).toEqual({ error: "cannot_modify_self" });
  });
  it("refuses to modify an env-admin", async () => {
    const actor = await makeUser("admin");
    const envAdmin = await makeUser("member", `envadmin-${Date.now()}@example.com`);
    const res = await setRole(actor.id, envAdmin.id, "admin", { ADMIN_EMAILS: envAdmin.email } as unknown as NodeJS.ProcessEnv);
    expect(res).toEqual({ error: "cannot_modify_env_admin" });
  });
});

describe("setDisabled", () => {
  it("disables a user and clears their sessions", async () => {
    const actor = await makeUser("admin");
    const target = await makeUser("member");
    await prisma.session.create({
      data: { id: `s-${target.id}`, userId: target.id, token: `t-${target.id}`, expiresAt: new Date(Date.now() + 1e6), createdAt: new Date(), updatedAt: new Date() },
    });
    expect(await setDisabled(actor.id, target.id, true)).toEqual({ ok: true });
    expect((await prisma.user.findUnique({ where: { id: target.id } }))!.disabled).toBe(true);
    expect(await prisma.session.count({ where: { userId: target.id } })).toBe(0);
  });
});

describe("listUsers", () => {
  it("returns users newest first", async () => {
    const base = Date.now();
    const older = await makeUser("member", undefined, new Date(base));
    const newer = await makeUser("member", undefined, new Date(base + 1000));
    const users = await listUsers();
    const iOlder = users.findIndex((u) => u.id === older.id);
    const iNewer = users.findIndex((u) => u.id === newer.id);
    expect(iNewer).toBeGreaterThanOrEqual(0);
    expect(iOlder).toBeGreaterThan(iNewer); // newer appears before older
  });
});

describe("normalizeAllowlistValue", () => {
  it("accepts email, bare domain, and '*'", () => {
    expect(normalizeAllowlistValue(" Alice@Corp.com ")).toBe("alice@corp.com");
    expect(normalizeAllowlistValue("@Corp.com")).toBe("corp.com");
    expect(normalizeAllowlistValue("*")).toBe("*");
  });
  it("rejects garbage", () => {
    expect(normalizeAllowlistValue("nope")).toBeNull();
    expect(normalizeAllowlistValue("a@b")).toBeNull();
  });
});

describe("addAllowlistEntry / removeAllowlistEntry", () => {
  it("adds a valid entry and removes it", async () => {
    const actor = await makeUser("admin");
    const value = `t-${Date.now()}-${Math.round(Math.random() * 1e6)}.com`;
    const res = await addAllowlistEntry(actor.id, value);
    expect("ok" in res && res.ok).toBe(true);
    const listed = await listAllowlist({} as NodeJS.ProcessEnv);
    expect(listed.db.some((e) => e.value === value)).toBe(true);
    if ("ok" in res) await removeAllowlistEntry(res.id);
    const after = await listAllowlist({} as NodeJS.ProcessEnv);
    expect(after.db.some((e) => e.value === value)).toBe(false);
  });
  it("rejects an invalid entry", async () => {
    const actor = await makeUser("admin");
    expect(await addAllowlistEntry(actor.id, "nope")).toEqual({ error: "invalid" });
  });
});
