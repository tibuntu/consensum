-- M10: tags + archiving.
ALTER TABLE "Document" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentTag" (
    "documentId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentTag_pkey" PRIMARY KEY ("documentId","tagId")
);

CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

CREATE INDEX "DocumentTag_tagId_idx" ON "DocumentTag"("tagId");

ALTER TABLE "DocumentTag" ADD CONSTRAINT "DocumentTag_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentTag" ADD CONSTRAINT "DocumentTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
