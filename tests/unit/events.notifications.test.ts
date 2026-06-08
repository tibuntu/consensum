import { describe, expect, test } from "vitest";
import { publish, subscribe, type ClientNotification } from "@/lib/events";

describe("per-user notification events", () => {
  test("subscriber receives a notification.created event", () => {
    const received: unknown[] = [];
    const off = subscribe("user-abc", (e) => received.push(e));
    const notification: ClientNotification = {
      id: "n1",
      type: "comment",
      documentId: "d1",
      documentTitle: "Plan",
      actorId: "u2",
      read: false,
      createdAt: new Date().toISOString(),
    };
    publish("user-abc", { type: "notification.created", notification });
    off();
    expect(received).toEqual([{ type: "notification.created", notification }]);
  });
});
