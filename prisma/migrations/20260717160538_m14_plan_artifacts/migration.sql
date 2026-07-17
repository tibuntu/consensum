-- CreateTable
CREATE TABLE "PlanArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "gitSha" TEXT,
    "pushedById" TEXT NOT NULL,
    "pushedAt" DATETIME NOT NULL,
    CONSTRAINT "PlanArtifact_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlanArtifact_pushedById_fkey" FOREIGN KEY ("pushedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanArtifact_documentId_name_key" ON "PlanArtifact"("documentId", "name");

-- CreateIndex
CREATE INDEX "PlanArtifact_pushedById_idx" ON "PlanArtifact"("pushedById");
