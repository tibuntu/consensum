/**
 * Fence runs of terminal "box-drawing" output so they render legibly.
 *
 * Plans pasted from a CLI often contain box-drawing tables and trees
 * (`┌────┬────┐`, `│ … │`, `├── src`) — Claude Code renders real markdown
 * tables this way in the terminal. That is not markdown: in the proportional
 * prose font the `─` runs fuse into stray horizontal rules and rows flow as
 * wrapped paragraph text. Wrapping such runs in code fences renders them
 * monospace with their alignment intact. The text itself is not rewritten —
 * reviewers still see exactly what was submitted, just in a font that
 * preserves the art.
 *
 * Heuristic, kept deliberately tight so prose and markdown structure are
 * never disturbed: a line counts as terminal art only if its first
 * non-whitespace character is a box-drawing char (U+2500–U+257F) or it
 * contains at least three of them, and only runs of two or more consecutive
 * such lines are fenced. Content already inside fenced code blocks is left
 * untouched.
 */

const BOX_CHAR = /[─-╿]/;
const BOX_CHARS_GLOBAL = /[─-╿]/g;
const FENCE_LINE = /^ {0,3}(```+|~~~+)/;

function isBoxLine(line: string): boolean {
  const first = line.trimStart()[0];
  if (first !== undefined && BOX_CHAR.test(first)) return true;
  return (line.match(BOX_CHARS_GLOBAL)?.length ?? 0) >= 3;
}

export function fenceTerminalArt(markdown: string): string {
  if (!markdown || !BOX_CHAR.test(markdown)) return markdown;

  const out: string[] = [];
  let run: string[] = [];
  let fenceMarker: string | null = null; // inside an existing code fence?

  const flush = () => {
    if (run.length >= 2) out.push("```text", ...run, "```");
    else out.push(...run);
    run = [];
  };

  for (const line of markdown.split("\n")) {
    const fence = line.match(FENCE_LINE)?.[1];
    if (fenceMarker) {
      out.push(line);
      // A closing fence uses the same char and at least the opening length.
      if (fence && fence[0] === fenceMarker[0] && fence.length >= fenceMarker.length) fenceMarker = null;
      continue;
    }
    if (fence) {
      flush();
      fenceMarker = fence;
      out.push(line);
      continue;
    }
    if (isBoxLine(line)) {
      run.push(line);
      continue;
    }
    flush();
    out.push(line);
  }
  flush();
  return out.join("\n");
}
