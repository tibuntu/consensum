-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Annotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "createdOnVersionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'COMMENT',
    "anchorExact" TEXT,
    "anchorPrefix" TEXT,
    "anchorSuffix" TEXT,
    "startOffset" INTEGER,
    "endOffset" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "threadStatus" TEXT NOT NULL DEFAULT 'OPEN',
    "authorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Annotation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Annotation_createdOnVersionId_fkey" FOREIGN KEY ("createdOnVersionId") REFERENCES "DocumentVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Annotation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Annotation" ("anchorExact", "anchorPrefix", "anchorSuffix", "authorId", "createdAt", "createdOnVersionId", "documentId", "endOffset", "id", "kind", "startOffset", "status", "threadStatus") SELECT "anchorExact", "anchorPrefix", "anchorSuffix", "authorId", "createdAt", "createdOnVersionId", "documentId", "endOffset", "id", "kind", "startOffset", "status", "threadStatus" FROM "Annotation";
DROP TABLE "Annotation";
ALTER TABLE "new_Annotation" RENAME TO "Annotation";
CREATE INDEX "Annotation_documentId_idx" ON "Annotation"("documentId");
CREATE INDEX "Annotation_createdOnVersionId_idx" ON "Annotation"("createdOnVersionId");
CREATE TABLE "new_Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "onVersionId" TEXT NOT NULL,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Review_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Review_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Review_onVersionId_fkey" FOREIGN KEY ("onVersionId") REFERENCES "DocumentVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Review" ("createdAt", "dismissed", "documentId", "id", "onVersionId", "reviewerId", "verdict") SELECT "createdAt", "dismissed", "documentId", "id", "onVersionId", "reviewerId", "verdict" FROM "Review";
DROP TABLE "Review";
ALTER TABLE "new_Review" RENAME TO "Review";
CREATE INDEX "Review_documentId_idx" ON "Review"("documentId");
CREATE INDEX "Review_onVersionId_idx" ON "Review"("onVersionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
