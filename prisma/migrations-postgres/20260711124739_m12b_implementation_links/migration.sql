-- ImplementationLink: doc-level pointers from a reviewed plan to where it was
-- implemented (PR/commit/branch URL). Added by M12b linkback.
CREATE TABLE "ImplementationLink" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImplementationLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImplementationLink_documentId_idx" ON "ImplementationLink"("documentId");

CREATE INDEX "ImplementationLink_createdById_idx" ON "ImplementationLink"("createdById");

ALTER TABLE "ImplementationLink" ADD CONSTRAINT "ImplementationLink_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ImplementationLink" ADD CONSTRAINT "ImplementationLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
