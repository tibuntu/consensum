-- DocumentParticipant.required: owner-designated must-approve reviewer (M9).
-- Existing rows default false (no prior required-reviewer concept to backfill).
ALTER TABLE "DocumentParticipant" ADD COLUMN "required" BOOLEAN NOT NULL DEFAULT false;
