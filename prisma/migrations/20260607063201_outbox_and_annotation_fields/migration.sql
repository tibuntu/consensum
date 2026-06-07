-- AlterTable
ALTER TABLE "Annotation" ADD COLUMN "category" TEXT;
ALTER TABLE "Annotation" ADD COLUMN "severity" TEXT;

-- CreateTable
CREATE TABLE "OutboxJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 6,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "OutboxJob_status_nextAttemptAt_idx" ON "OutboxJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Annotation_authorId_idx" ON "Annotation"("authorId");

-- CreateIndex
CREATE INDEX "Comment_authorId_idx" ON "Comment"("authorId");

-- CreateIndex
CREATE INDEX "DocumentVersion_createdById_idx" ON "DocumentVersion"("createdById");

-- CreateIndex
CREATE INDEX "Review_reviewerId_idx" ON "Review"("reviewerId");
