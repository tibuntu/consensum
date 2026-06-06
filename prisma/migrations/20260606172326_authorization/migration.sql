-- CreateTable
CREATE TABLE "DocumentParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentParticipant_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocumentParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ApiToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    "scopes" TEXT NOT NULL DEFAULT 'plans:write,feedback:read',
    CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ApiToken" ("createdAt", "id", "label", "lastUsedAt", "tokenHash", "userId") SELECT "createdAt", "id", "label", "lastUsedAt", "tokenHash", "userId" FROM "ApiToken";
DROP TABLE "ApiToken";
ALTER TABLE "new_ApiToken" RENAME TO "ApiToken";
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DocumentParticipant_userId_idx" ON "DocumentParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentParticipant_documentId_userId_key" ON "DocumentParticipant"("documentId", "userId");

-- Backfill participants for pre-existing documents: owner + annotation/comment/review authors.
INSERT INTO "DocumentParticipant" ("id", "documentId", "userId", "createdAt")
SELECT lower(hex(randomblob(16))) AS "id", "documentId", "userId", CURRENT_TIMESTAMP
FROM (
  SELECT "id" AS "documentId", "ownerId" AS "userId" FROM "Document"
  UNION
  SELECT "documentId", "authorId" FROM "Annotation"
  UNION
  SELECT a."documentId", c."authorId" FROM "Comment" c JOIN "Annotation" a ON c."annotationId" = a."id"
  UNION
  SELECT "documentId", "reviewerId" FROM "Review"
);
