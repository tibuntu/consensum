import { describe, expect, test } from "vitest";
import { notificationLabel } from "@/lib/notification-format";

describe("notificationLabel", () => {
  test("names the actor when known", () => {
    expect(notificationLabel("comment", "Blair")).toBe("Blair commented");
    expect(notificationLabel("review", "Blair")).toBe("Blair recorded a decision");
    expect(notificationLabel("version", "Blair")).toBe("Blair added a new version");
    expect(notificationLabel("resolve", "Blair")).toBe("Blair resolved a thread");
  });

  test("falls back to a generic label without an actor", () => {
    expect(notificationLabel("comment", null)).toBe("New comment");
    expect(notificationLabel("review", null)).toBe("New decision");
    expect(notificationLabel("version", null)).toBe("New version");
    expect(notificationLabel("resolve", undefined)).toBe("Thread resolved");
  });

  test("uses the raw type for unknown kinds", () => {
    expect(notificationLabel("mystery", "Blair")).toBe("mystery");
  });
});
