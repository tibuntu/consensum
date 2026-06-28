-- AlterTable
ALTER TABLE "OutboxJob" ADD COLUMN "claimedAt" DATETIME;
ALTER TABLE "OutboxJob" ADD COLUMN "claimedBy" TEXT;
