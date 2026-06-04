import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs the test toolchain", () => {
    expect(1 + 1).toBe(2);
  });
});
