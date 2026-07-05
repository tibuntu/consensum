import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { checkMachineRateLimit, rateHeaders } from "@/lib/rate-limit-machine";

const envWith = (rpm?: string) => ({ ...process.env, RATE_LIMIT_MACHINE_RPM: rpm }) as NodeJS.ProcessEnv;
const freshId = () => `tok-${Date.now()}-${Math.round(Math.random()*1e6)}`;

describe("checkMachineRateLimit", () => {
  test("counts within the window and blocks at the limit with Retry-After", async () => {
    const id = freshId();
    const t0 = 1_000_000_000_000;
    expect((await checkMachineRateLimit(id, t0, envWith("3"))).allowed).toBe(true);
    expect((await checkMachineRateLimit(id, t0 + 1000, envWith("3"))).allowed).toBe(true);
    const third = await checkMachineRateLimit(id, t0 + 2000, envWith("3"));
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = await checkMachineRateLimit(id, t0 + 3000, envWith("3"));
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(fourth.resetAt).toBe(Math.ceil((t0 + 60_000) / 1000));
  });

  test("window expiry resets the budget", async () => {
    const id = freshId();
    const t0 = 1_000_000_000_000;
    await checkMachineRateLimit(id, t0, envWith("1"));
    expect((await checkMachineRateLimit(id, t0 + 1000, envWith("1"))).allowed).toBe(false);
    expect((await checkMachineRateLimit(id, t0 + 61_000, envWith("1"))).allowed).toBe(true);
  });

  test("0 disables; invalid/absent falls back to 120", async () => {
    const off = await checkMachineRateLimit(freshId(), Date.now(), envWith("0"));
    expect(off).toEqual({ allowed: true, limit: 0, remaining: 0, resetAt: 0, retryAfterSec: 0 });
    expect(rateHeaders(off)).toEqual({});
    expect((await checkMachineRateLimit(freshId(), Date.now(), envWith("banana"))).limit).toBe(120);
    expect((await checkMachineRateLimit(freshId(), Date.now(), envWith(undefined))).limit).toBe(120);
  });

  test("header shape", async () => {
    const rc = await checkMachineRateLimit(freshId(), 1_000_000_000_000, envWith("5"));
    expect(rateHeaders(rc)).toEqual({
      "X-RateLimit-Limit": "5",
      "X-RateLimit-Remaining": "4",
      "X-RateLimit-Reset": String(Math.ceil((1_000_000_000_000 + 60_000) / 1000)),
    });
  });

  test("fails open on storage error", async () => {
    const spy = vi.spyOn(prisma.rateLimit, "findUnique").mockRejectedValueOnce(new Error("boom"));
    const rc = await checkMachineRateLimit(freshId(), Date.now(), envWith("5"));
    expect(rc.allowed).toBe(true);
    spy.mockRestore();
  });
});
