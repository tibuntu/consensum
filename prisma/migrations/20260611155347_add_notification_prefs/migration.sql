-- AlterTable
ALTER TABLE "User" ADD COLUMN "notificationPrefs" JSONB;

-- Backfill per-type prefs from the legacy global booleans.
UPDATE "User"
SET "notificationPrefs" = json_object(
  'comment', json_object('inApp', json('true'), 'email',   json(CASE WHEN "emailNotifications" = 1 THEN 'true' ELSE 'false' END), 'desktop', json(CASE WHEN "desktopNotifications" = 1 THEN 'true' ELSE 'false' END)),
  'review',  json_object('inApp', json('true'), 'email',   json(CASE WHEN "emailNotifications" = 1 THEN 'true' ELSE 'false' END), 'desktop', json(CASE WHEN "desktopNotifications" = 1 THEN 'true' ELSE 'false' END)),
  'version', json_object('inApp', json('true'), 'email',   json(CASE WHEN "emailNotifications" = 1 THEN 'true' ELSE 'false' END), 'desktop', json(CASE WHEN "desktopNotifications" = 1 THEN 'true' ELSE 'false' END)),
  'resolve', json_object('inApp', json('true'), 'desktop', json(CASE WHEN "desktopNotifications" = 1 THEN 'true' ELSE 'false' END))
)
WHERE "notificationPrefs" IS NULL;
