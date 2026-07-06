import { describe, it, expect } from "vitest";
import { fenceTerminalArt } from "@/lib/terminal-art";

const boxTable = [
  "  ┌────────┬────────┐",
  "  │ Status │ Anzahl │",
  "  ├────────┼────────┤",
  "  │ ✅     │ 36     │",
  "  └────────┴────────┘",
].join("\n");

describe("fenceTerminalArt", () => {
  it("fences a pasted box-drawing table as a code block", () => {
    const result = fenceTerminalArt(`Scan-Ergebnis:\n${boxTable}\nHinweis: danach.`);
    expect(result).toBe(`Scan-Ergebnis:\n\`\`\`text\n${boxTable}\n\`\`\`\nHinweis: danach.`);
  });

  it("fences terminal file trees (├──/└── lines)", () => {
    const tree = "├── src\n└── tests";
    expect(fenceTerminalArt(tree)).toBe("```text\n" + tree + "\n```");
  });

  it("does not rewrite the art lines themselves", () => {
    const result = fenceTerminalArt(boxTable);
    for (const line of boxTable.split("\n")) expect(result).toContain(line);
  });

  it("leaves valid GFM pipe tables untouched", () => {
    const gfm = "| Status | Anzahl |\n|--------|--------|\n| ok | 36 |";
    expect(fenceTerminalArt(gfm)).toBe(gfm);
  });

  it("leaves prose with a single stray box char untouched (no 1-line runs)", () => {
    const md = "Die Spalte │ trennt Werte.\n\nNormaler Text.";
    expect(fenceTerminalArt(md)).toBe(md);
  });

  it("does not double-fence art already inside a code fence", () => {
    const fenced = "```\n" + boxTable + "\n```";
    expect(fenceTerminalArt(fenced)).toBe(fenced);
  });

  it("treats a fence info string and longer closing fences correctly", () => {
    const fenced = "````text\n│ inside │\n│ still  │\n````\n" + boxTable;
    expect(fenceTerminalArt(fenced)).toBe("````text\n│ inside │\n│ still  │\n````\n```text\n" + boxTable + "\n```");
  });

  it("returns box-free markdown unchanged (fast path)", () => {
    const md = "# Title\n\nplain paragraph";
    expect(fenceTerminalArt(md)).toBe(md);
  });

  it("handles empty input", () => {
    expect(fenceTerminalArt("")).toBe("");
  });
});
