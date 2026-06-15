import { describe, expect, test } from "vitest";
import { buildHighlightRanges } from "@/lib/highlight";

const TEXT = "The team approves the plan after careful review of every section.";

// A thread anchored to "approves the plan" — relocate finds it exactly (ACTIVE).
function anchor(id: string, threadStatus: string) {
  return {
    id,
    anchorExact: "approves the plan",
    anchorPrefix: "The team ",
    anchorSuffix: " after careful",
    threadStatus,
  };
}

describe("buildHighlightRanges", () => {
  test("includes an active (unresolved) thread's range", () => {
    const { ranges, statuses } = buildHighlightRanges(TEXT, [anchor("a1", "OPEN")]);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({ id: "a1", status: "ACTIVE" });
    expect(statuses["a1"]).toBe("ACTIVE");
  });

  test("excludes a resolved thread's range so its in-text marker disappears", () => {
    const { ranges, statuses } = buildHighlightRanges(TEXT, [anchor("a1", "RESOLVED")]);
    expect(ranges).toHaveLength(0);
    // Status is still tracked (sidebar/orphan indicators rely on it).
    expect(statuses["a1"]).toBe("ACTIVE");
  });

  test("keeps active threads while dropping resolved ones in a mixed set", () => {
    const { ranges } = buildHighlightRanges(TEXT, [
      anchor("active", "OPEN"),
      anchor("done", "RESOLVED"),
    ]);
    expect(ranges.map((r) => r.id)).toEqual(["active"]);
  });
});
