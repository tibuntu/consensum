/**
 * Human label for an inbox notification. Names the actor when known
 * ("Blair commented"), falling back to a generic label otherwise. Pure so it can
 * be shared by the inbox list and the desktop-notification body, and unit-tested.
 */
export function notificationLabel(type: string, actorName?: string | null): string {
  const who = actorName?.trim() || null;
  switch (type) {
    case "comment":
      return who ? `${who} commented` : "New comment";
    case "review":
      return who ? `${who} recorded a decision` : "New decision";
    case "version":
      return who ? `${who} added a new version` : "New version";
    case "resolve":
      return who ? `${who} resolved a thread` : "Thread resolved";
    case "shared":
      return who ? `${who} shared a document` : "Document shared with you";
    default:
      return type;
  }
}
