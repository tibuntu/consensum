import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL ?? "file:./data/app.db";
const isPostgres = /^postgres(ql)?:\/\//.test(url);

// Pick the driver adapter from the DATABASE_URL scheme: postgres(ql):// → pg,
// otherwise the embedded SQLite driver (the default single-container mode).
function createAdapter() {
  return isPostgres ? new PrismaPg(url) : new PrismaBetterSqlite3({ url });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: createAdapter() });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// SQLite: enable WAL for better concurrent-read performance. Not applicable to Postgres.
if (!isPostgres) {
  prisma.$executeRawUnsafe("PRAGMA journal_mode = WAL;").catch((err) => {
    console.error("[db] Failed to set WAL mode:", err);
  });
}
