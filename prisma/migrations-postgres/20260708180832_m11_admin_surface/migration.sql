-- User.disabled: admin-set deactivation flag (M11). Existing rows default false
-- (no prior deactivation concept). Enforced at login, session sweep, and token verify.
ALTER TABLE "User" ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT false;

-- RegistrationAllowlistEntry: DB-backed registration allowlist, unioned with the
-- env REGISTRATION_ALLOWLIST at check time. `value` is an exact email, a bare
-- domain, or "*"; unique so re-adding an entry is idempotent (upsert on value).
CREATE TABLE "RegistrationAllowlistEntry" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "RegistrationAllowlistEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RegistrationAllowlistEntry_value_key" ON "RegistrationAllowlistEntry"("value");
