-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DocumentParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'REVIEWER',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentParticipant_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocumentParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DocumentParticipant" ("createdAt", "documentId", "id", "role", "userId") SELECT "createdAt", "documentId", "id", "role", "userId" FROM "DocumentParticipant";
DROP TABLE "DocumentParticipant";
ALTER TABLE "new_DocumentParticipant" RENAME TO "DocumentParticipant";
CREATE INDEX "DocumentParticipant_userId_idx" ON "DocumentParticipant"("userId");
CREATE UNIQUE INDEX "DocumentParticipant_documentId_userId_key" ON "DocumentParticipant"("documentId", "userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
