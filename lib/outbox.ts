import { prisma } from "@/lib/db";
import { randomUUID } from "node:crypto";

const DEFAULT_BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];

function backoffTable(): number[] {
  const raw = process.env.OUTBOX_BACKOFF_MS;
  if (!raw) return DEFAULT_BACKOFF_MS;
  const parsed = raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0);
  return parsed.length > 0 ? parsed : DEFAULT_BACKOFF_MS;
}

/** Delay before the n-th retry (attempts = the new, post-increment attempt count, >= 1). */
export function computeBackoffMs(attempts: number): number {
  const table = backoffTable();
  const idx = Math.min(Math.max(attempts, 1) - 1, table.length - 1);
  return table[idx];
}

type Handler = (payload: unknown) => Promise<void>;
type DeadHandler = (payload: unknown, lastError: string) => Promise<void> | void;

const globalForOutbox = globalThis as unknown as {
  outboxHandlers?: Map<string, Handler>;
  outboxDeadHandlers?: Map<string, DeadHandler>;
  outboxTimer?: ReturnType<typeof setInterval>;
};
const handlers: Map<string, Handler> = globalForOutbox.outboxHandlers ?? new Map();
globalForOutbox.outboxHandlers = handlers;
const deadHandlers: Map<string, DeadHandler> = globalForOutbox.outboxDeadHandlers ?? new Map();
globalForOutbox.outboxDeadHandlers = deadHandlers;

export function registerHandler(type: string, fn: Handler, onDead?: DeadHandler): void {
  handlers.set(type, fn);
  if (onDead) deadHandlers.set(type, onDead);
}

/** Test hook: clear the handler registry between tests. */
export function __resetHandlers(): void {
  handlers.clear();
  deadHandlers.clear();
}

export async function enqueue(
  type: string,
  payload: unknown,
  opts?: { delayMs?: number },
): Promise<string> {
  const job = await prisma.outboxJob.create({
    data: {
      type,
      payload: JSON.stringify(payload ?? null),
      maxAttempts: Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 6),
      nextAttemptAt: new Date(Date.now() + (opts?.delayMs ?? 0)),
    },
  });
  return job.id;
}

// A per-process identity for the lease holder. Atomic claiming (below) makes the
// worker safe to run on every replica concurrently — no leader election.
const WORKER_ID = randomUUID();
const LEASE_MS = Number(process.env.OUTBOX_LEASE_MS ?? 300_000); // 5 min
const isPostgres = /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? "");

/**
 * Reclaim jobs whose lease has expired — i.e. a worker crashed mid-delivery.
 * Lease-based (not "reset all DELIVERING"), so a replica booting or polling never
 * re-arms a job another live worker is actively delivering. Safe for N replicas.
 */
export async function recoverStuckJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - LEASE_MS);
  await prisma.outboxJob.updateMany({
    // Expired lease, or a DELIVERING row with no lease at all (anomalous/legacy) —
    // both are stuck. A fresh lease (claimedAt >= cutoff) is left to its live owner.
    where: { status: "DELIVERING", OR: [{ claimedAt: null }, { claimedAt: { lt: cutoff } }] },
    data: { status: "PENDING", claimedAt: null, claimedBy: null },
  });
}

type ClaimedJob = { id: string; type: string; payload: string; attempts: number; maxAttempts: number };

/**
 * Atomically claim up to `limit` due jobs, marking them DELIVERING under this
 * worker's lease. Two replicas polling at once never grab the same job:
 *   - Postgres: `FOR UPDATE SKIP LOCKED` lets each worker take a disjoint set.
 *   - SQLite: a write transaction (single-writer file lock) serializes the claim.
 */
export async function claimDueJobs(limit: number): Promise<ClaimedJob[]> {
  const now = new Date();
  if (isPostgres) {
    return prisma.$queryRaw<ClaimedJob[]>`
      UPDATE "OutboxJob"
         SET status = 'DELIVERING', "claimedAt" = ${now}, "claimedBy" = ${WORKER_ID}
       WHERE id IN (
         SELECT id FROM "OutboxJob"
          WHERE status = 'PENDING' AND "nextAttemptAt" <= ${now}
          ORDER BY "nextAttemptAt" ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING id, type, payload, attempts, "maxAttempts";
    `;
  }
  return prisma.$transaction(async (tx) => {
    const due = await tx.outboxJob.findMany({
      where: { status: "PENDING", nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: "asc" },
      take: limit,
      select: { id: true },
    });
    if (due.length === 0) return [];
    const ids = due.map((d) => d.id);
    await tx.outboxJob.updateMany({
      where: { id: { in: ids } },
      data: { status: "DELIVERING", claimedAt: now, claimedBy: WORKER_ID },
    });
    return tx.outboxJob.findMany({
      where: { id: { in: ids } },
      select: { id: true, type: true, payload: true, attempts: true, maxAttempts: true },
    });
  });
}

const BATCH = Number(process.env.OUTBOX_BATCH ?? 25);
let ticking = false;

/** Process all currently-due jobs once. In-process guard + atomic cross-process claim. */
export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await recoverStuckJobs();
    const due = await claimDueJobs(BATCH);
    for (const job of due) {
      const handler = handlers.get(job.type);
      if (!handler) {
        await prisma.outboxJob.update({
          where: { id: job.id },
          data: { status: "DEAD", lastError: `no handler for type "${job.type}"`, claimedAt: null, claimedBy: null },
        });
        continue;
      }
      try {
        await handler(JSON.parse(job.payload));
        await prisma.outboxJob.update({ where: { id: job.id }, data: { status: "DONE", claimedAt: null, claimedBy: null } });
      } catch (err) {
        const attempts = job.attempts + 1;
        const lastError = err instanceof Error ? err.message : String(err);
        if (attempts >= job.maxAttempts) {
          await prisma.outboxJob.update({
            where: { id: job.id },
            data: { status: "DEAD", attempts, lastError, claimedAt: null, claimedBy: null },
          });
          const onDead = deadHandlers.get(job.type);
          if (onDead) {
            try { await onDead(JSON.parse(job.payload), lastError); }
            catch { /* best-effort: dead-letter visibility must not crash the worker */ }
          }
        } else {
          await prisma.outboxJob.update({
            where: { id: job.id },
            data: {
              status: "PENDING",
              attempts,
              lastError,
              nextAttemptAt: new Date(Date.now() + computeBackoffMs(attempts)),
              claimedAt: null,
              claimedBy: null,
            },
          });
        }
      }
    }
  } finally {
    ticking = false;
  }
}

function shouldAutoStart(): boolean {
  const flag = process.env.OUTBOX_WORKER_AUTOSTART;
  if (flag != null) return flag === "true" || flag === "1";
  return process.env.NODE_ENV !== "test";
}

/** Idempotent. Starts the polling loop once per process (globalThis-guarded). */
export function startOutboxWorker(): void {
  if (!shouldAutoStart()) return;
  if (globalForOutbox.outboxTimer) return;
  const pollMs = Number(process.env.OUTBOX_POLL_MS ?? 5_000);
  void recoverStuckJobs();
  globalForOutbox.outboxTimer = setInterval(() => { void tick(); }, pollMs);
  // Don't keep the event loop alive solely for polling.
  globalForOutbox.outboxTimer.unref?.();
}
