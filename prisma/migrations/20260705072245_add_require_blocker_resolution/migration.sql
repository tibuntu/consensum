-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "requiredApprovals" INTEGER NOT NULL DEFAULT 1,
    "requireBlockerResolution" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'WEB',
    "agentContext" TEXT,
    "idempotencyKey" TEXT,
    "currentVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Document_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Document_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "DocumentVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Document" ("agentContext", "createdAt", "currentVersionId", "id", "idempotencyKey", "ownerId", "requiredApprovals", "source", "state", "title", "updatedAt") SELECT "agentContext", "createdAt", "currentVersionId", "id", "idempotencyKey", "ownerId", "requiredApprovals", "source", "state", "title", "updatedAt" FROM "Document";
DROP TABLE "Document";
ALTER TABLE "new_Document" RENAME TO "Document";
CREATE UNIQUE INDEX "Document_currentVersionId_key" ON "Document"("currentVersionId");
CREATE INDEX "Document_ownerId_idx" ON "Document"("ownerId");
CREATE INDEX "Document_state_idx" ON "Document"("state");
CREATE UNIQUE INDEX "Document_ownerId_idempotencyKey_key" ON "Document"("ownerId", "idempotencyKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
