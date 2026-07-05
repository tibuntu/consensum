-- Document.visibility: new column defaults PRIVATE; existing rows backfilled to LINK
-- (their current implicit-link-grant behavior). New docs default PRIVATE (see createDocument).
ALTER TABLE "Document" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PRIVATE';
UPDATE "Document" SET "visibility" = 'LINK';

-- DocumentParticipant.role: default + backfill REVIEWER (they can already review today).
ALTER TABLE "DocumentParticipant" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'REVIEWER';
