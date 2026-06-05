export interface HighlightRange {
  id: string;
  start: number;
  end: number;
  status?: string; // "ACTIVE" | "MOVED"
}

/**
 * Wrap each range's `[start,end)` slice (offsets measured against the container's
 * concatenated text content) in a `<mark data-annotation-id>`. Idempotent: existing
 * marks are unwrapped first, then re-applied. Ranges that would cross an element
 * boundary are skipped (MVP fallback — see plan Task 7 Step 4).
 */
export function applyHighlights(container: HTMLElement, ranges: HighlightRange[]): void {
  clearHighlights(container);
  for (const range of ranges) {
    wrapRange(container, range);
  }
}

export function clearHighlights(container: HTMLElement): void {
  const marks = container.querySelectorAll("mark[data-annotation-id]");
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

function wrapRange(container: HTMLElement, range: HighlightRange): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.data.length;
    // Only handle ranges that fall entirely within a single text node.
    if (range.start >= offset && range.end <= offset + len && range.end > range.start) {
      const localStart = range.start - offset;
      const localEnd = range.end - offset;
      const domRange = document.createRange();
      domRange.setStart(node, localStart);
      domRange.setEnd(node, localEnd);
      const mark = document.createElement("mark");
      const moved = range.status === "MOVED";
      mark.className = `${moved ? "bg-orange-200" : "bg-yellow-200"} cursor-pointer`;
      mark.setAttribute("data-annotation-id", range.id);
      mark.setAttribute("data-status", range.status ?? "ACTIVE");
      if (moved) mark.title = "This comment moved when the document was edited.";
      try {
        domRange.surroundContents(mark);
      } catch {
        // Crosses an element boundary — fallback: no inline mark for this range.
      }
      return;
    }
    offset += len;
    node = walker.nextNode() as Text | null;
  }
}
