import { describe, it, expect } from "vitest";
import { buildQuote, locate } from "@/lib/anchoring";

const body = "The cloud setup is fine. The cloud setup needs review. Done.";

describe("anchoring", () => {
  it("builds a quote with bounded context", () => {
    const start = body.indexOf("needs review");
    const q = buildQuote(body, start, start + "needs review".length);
    expect(q.exact).toBe("needs review");
    expect(q.prefix.endsWith("The cloud setup ")).toBe(true);
    expect(q.suffix.startsWith(".")).toBe(true);
  });

  it("locates a unique exact match", () => {
    const q = buildQuote(body, body.indexOf("Done"), body.indexOf("Done") + 4);
    expect(locate(body, q)).toEqual({ start: body.indexOf("Done"), end: body.indexOf("Done") + 4 });
  });

  it("disambiguates repeated text via context", () => {
    const second = body.indexOf("cloud setup", 10);
    const q = buildQuote(body, second, second + "cloud setup".length);
    expect(locate(body, q)).toEqual({ start: second, end: second + "cloud setup".length });
  });

  it("returns null when the text is gone (orphan)", () => {
    expect(locate("totally different text", { exact: "cloud setup", prefix: "", suffix: "" })).toBeNull();
  });
});
