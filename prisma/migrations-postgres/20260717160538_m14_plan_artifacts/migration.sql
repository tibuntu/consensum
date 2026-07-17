-- PlanArtifact: plan-attached progress artifacts (tasks.json + status summary)
-- pushed by the agent at loop checkpoints. Latest-wins per (documentId, name).
-- Added by m14 session-state handover.
CREATE TABLE "PlanArtifact" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "gitSha" TEXT,
    "pushedById" TEXT NOT NULL,
    "pushedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanArtifact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanArtifact_documentId_name_key" ON "PlanArtifact"("documentId", "name");

CREATE INDEX "PlanArtifact_pushedById_idx" ON "PlanArtifact"("pushedById");

ALTER TABLE "PlanArtifact" ADD CONSTRAINT "PlanArtifact_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlanArtifact" ADD CONSTRAINT "PlanArtifact_pushedById_fkey" FOREIGN KEY ("pushedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
