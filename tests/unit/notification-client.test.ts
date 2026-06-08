import { describe, expect, test } from "vitest";
import { nextUnread, shouldFireOsNotification } from "@/lib/notification-client";
import type { DocEvent } from "@/lib/events";

describe("nextUnread", () => {
  test("transitions", () => {
    expect(nextUnread(2, { type: "notification.created" } as DocEvent)).toBe(3);
    expect(nextUnread(2, { type: "notification.read" } as DocEvent)).toBe(1);
    expect(nextUnread(0, { type: "notification.read" } as DocEvent)).toBe(0);
    expect(nextUnread(5, { type: "notification.read.all" } as DocEvent)).toBe(0);
    expect(nextUnread(5, { type: "version.created" } as DocEvent)).toBe(5);
  });
});

describe("shouldFireOsNotification", () => {
  const base = {
    desktopEnabled: true,
    permission: "granted" as const,
    visibility: "hidden" as const,
    seen: new Set<string>(),
    id: "n1",
  };
  test("fires only when all conditions hold", () => {
    expect(shouldFireOsNotification(base)).toBe(true);
    expect(shouldFireOsNotification({ ...base, desktopEnabled: false })).toBe(false);
    expect(shouldFireOsNotification({ ...base, permission: "default" })).toBe(false);
    expect(shouldFireOsNotification({ ...base, visibility: "visible" })).toBe(false);
    expect(shouldFireOsNotification({ ...base, seen: new Set(["n1"]) })).toBe(false);
  });
});
