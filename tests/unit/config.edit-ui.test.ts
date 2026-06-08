import { describe, expect, test } from "vitest";
import { isEditUiEnabled } from "@/lib/config";

describe("isEditUiEnabled", () => {
  test("defaults to enabled when unset", () => {
    expect(isEditUiEnabled({})).toBe(true);
  });
  test("disabled only by 'false' (case-insensitive)", () => {
    expect(isEditUiEnabled({ EDIT_UI_ENABLED: "false" })).toBe(false);
    expect(isEditUiEnabled({ EDIT_UI_ENABLED: "FALSE" })).toBe(false);
  });
  test("enabled for 'true' or any other value", () => {
    expect(isEditUiEnabled({ EDIT_UI_ENABLED: "true" })).toBe(true);
    expect(isEditUiEnabled({ EDIT_UI_ENABLED: "1" })).toBe(true);
  });
});
