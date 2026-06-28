-- AlterTable
ALTER TABLE "OutboxJob" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "claimedBy" TEXT;
