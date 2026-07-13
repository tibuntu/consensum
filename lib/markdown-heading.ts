/**
 * Detect whether a markdown document's FIRST block is a level-1 ATX heading
 * (`# Title`). Used to de-emphasize that leading body H1 on the document view
 * so it doesn't stack as a duplicate top-level heading under the page title.
 *
 * Robustness: only the very first non-blank line counts. A leading H1 must be a
 * real ATX `# ` heading (one `#` then a space/tab); `##`+ and Setext underlines
 * are NOT treated as a leading H1. Leading blank lines are skipped. A fenced
 * code block opening (``` or ~~~) on the first line is never a heading.
 */
export function startsWithH1(markdown: string): boolean {
  return leadingH1Line(markdown) !== null;
}

/**
 * The 1-based source line of the document's leading ATX H1 (`# Title`), or null
 * when the first block isn't one. Callers match this against a rendered heading's
 * `node.position.start.line` to demote ONLY that heading — a deterministic check
 * that holds identically across SSR and hydration (unlike a render-order counter).
 */
export function leadingH1Line(markdown: string): number | null {
  if (!markdown) return null;
  // First non-blank line.
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) return null;
  // ATX H1: optional up-to-3 leading spaces, exactly one '#', then space/tab or EOL.
  return /^ {0,3}#(?: |\t|$)/.test(lines[i]) ? i + 1 : null;
}
