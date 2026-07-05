import { prisma } from "@/lib/db";
import { rateLimitMachineRpm } from "@/lib/config";

export interface RateCheck {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix epoch seconds when the current window resets (0 when disabled). */
  resetAt: number;
  retryAfterSec: number;
}

const WINDOW_MS = 60_000;

/**
 * Fixed 60s window per token over the DB-backed RateLimit table (the same
 * storage better-auth uses — key formats are disjoint, and better-auth's
 * table-wide expired-row prune incidentally garbage-collects our
 * `machine:*` rows in production, so no explicit cleanup is needed).
 * Fail-open: a storage error logs and admits the request — agent-loop
 * availability beats strict quota enforcement. The counting is deliberately
 * approximate: the window-reset write is not a CAS, so concurrent requests
 * racing a rollover can each be admitted with count=1. This is a soft
 * guard for runaway agent loops, not a security boundary.
 */
export async function checkMachineRateLimit(
  tokenId: string,
  now: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<RateCheck> {
  const limit = rateLimitMachineRpm(env);
  if (limit === 0) return { allowed: true, limit: 0, remaining: 0, resetAt: 0, retryAfterSec: 0 };
  const id = `machine:${tokenId}`;
  try {
    const row = await prisma.rateLimit.findUnique({ where: { id } });
    const windowStart = row?.lastRequest ? Number(row.lastRequest) : 0;
    const inWindow = row && windowStart > now - WINDOW_MS ? (row.count ?? 0) : 0;
    if (inWindow >= limit) {
      const resetAt = Math.ceil((windowStart + WINDOW_MS) / 1000);
      return { allowed: false, limit, remaining: 0, resetAt, retryAfterSec: Math.max(1, resetAt - Math.floor(now / 1000)) };
    }
    if (inWindow === 0) {
      await prisma.rateLimit.upsert({
        where: { id },
        create: { id, key: id, count: 1, lastRequest: BigInt(now) },
        update: { count: 1, lastRequest: BigInt(now) },
      });
      return { allowed: true, limit, remaining: limit - 1, resetAt: Math.ceil((now + WINDOW_MS) / 1000), retryAfterSec: 0 };
    }
    await prisma.rateLimit.update({ where: { id }, data: { count: { increment: 1 } } });
    return { allowed: true, limit, remaining: Math.max(0, limit - inWindow - 1), resetAt: Math.ceil((windowStart + WINDOW_MS) / 1000), retryAfterSec: 0 };
  } catch (e) {
    console.error("machine rate-limit check failed (failing open)", e);
    return { allowed: true, limit, remaining: limit, resetAt: Math.ceil((now + WINDOW_MS) / 1000), retryAfterSec: 0 };
  }
}

/** Response headers for a post-auth machine response. Empty when disabled. */
export function rateHeaders(rc: RateCheck): Record<string, string> {
  if (rc.limit === 0) return {};
  return {
    "X-RateLimit-Limit": String(rc.limit),
    "X-RateLimit-Remaining": String(rc.remaining),
    "X-RateLimit-Reset": String(rc.resetAt),
  };
}
