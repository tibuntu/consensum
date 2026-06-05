import { describe, it, expect } from "vitest";
import { publish, subscribe, type DocEvent } from "@/lib/events";

describe("event bus", () => {
  it("delivers events to subscribers of the same document only", () => {
    const got: DocEvent[] = [];
    const unsub = subscribe("doc-1", (e) => got.push(e));
    publish("doc-1", { type: "review.updated", state: "OPEN" });
    publish("doc-2", { type: "review.updated", state: "APPROVED" });
    expect(got).toHaveLength(1);
    expect(got[0]).toEqual({ type: "review.updated", state: "OPEN" });
    unsub();
  });

  it("stops delivery after unsubscribe", () => {
    const got: DocEvent[] = [];
    const unsub = subscribe("doc-3", (e) => got.push(e));
    publish("doc-3", { type: "review.updated", state: "OPEN" });
    unsub();
    publish("doc-3", { type: "review.updated", state: "APPROVED" });
    expect(got).toHaveLength(1);
  });
});
