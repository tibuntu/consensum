import { describe, expect, test } from "vitest";
import { highlightClass } from "@/lib/highlight";

// Annotation highlights must be driven by the token system (so they flip for dark
// mode), not hardcoded light-only Tailwind palette colors (F72/F25).
describe("highlightClass", () => {
  test("active annotations use the token-driven highlight class", () => {
    const c = highlightClass("ACTIVE");
    expect(c).toContain("annotation-highlight");
    expect(c).not.toContain("annotation-highlight-moved");
    expect(c).not.toMatch(/bg-(yellow|orange)/);
  });

  test("moved annotations use the moved highlight class", () => {
    const c = highlightClass("MOVED");
    expect(c).toContain("annotation-highlight-moved");
    expect(c).not.toMatch(/bg-(yellow|orange)/);
  });

  test("undefined status defaults to the active highlight class", () => {
    expect(highlightClass()).toContain("annotation-highlight");
    expect(highlightClass()).not.toContain("annotation-highlight-moved");
  });
});
