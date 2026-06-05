"use client";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { buildQuote, locate, type Quote } from "@/lib/anchoring";
import { applyHighlights, type HighlightRange } from "@/lib/highlight";
import CommentSidebar from "@/components/CommentSidebar";

export interface ClientComment {
  id: string;
  body: string;
  author?: { name?: string | null; email?: string | null } | null;
}
export interface ClientAnnotation {
  id: string;
  anchorExact: string | null;
  anchorPrefix: string | null;
  anchorSuffix: string | null;
  startOffset: number | null;
  endOffset: number | null;
  threadStatus: string;
  comments: ClientComment[];
}
export interface ClientDocument {
  id: string;
  title: string;
  state: string;
  markdown: string;
  annotations: ClientAnnotation[];
}

const STATE_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
  CLOSED: "Closed",
};

// Memoized so React never reconciles the rendered-markdown subtree after mount.
// `markdown` is constant for a v1 document (no in-app editing in part 1), which
// makes it safe for the highlight helper to mutate that DOM directly.
const RenderedMarkdown = memo(function RenderedMarkdown({ markdown }: { markdown: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>;
});

interface PendingSelection {
  quote: Quote;
  startOffset: number;
  endOffset: number;
}

export default function DocumentView({ doc }: { doc: ClientDocument }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [annotations, setAnnotations] = useState<ClientAnnotation[]>(doc.annotations);
  const [selection, setSelection] = useState<PendingSelection | null>(null);
  const [pendingBody, setPendingBody] = useState("");
  const [docState, setDocState] = useState(doc.state);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  // Capture text selections via selectionchange so both real pointer selection
  // and programmatic selection (Playwright selectText) are picked up.
  useEffect(() => {
    function onSelectionChange() {
      const sel = document.getSelection();
      const container = containerRef.current;
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !container) return;
      const range = sel.getRangeAt(0);
      if (!container.contains(range.startContainer)) return;
      const selectedText = sel.toString();
      if (!selectedText.trim()) return;
      const pre = document.createRange();
      pre.selectNodeContents(container);
      pre.setEnd(range.startContainer, range.startOffset);
      const start = pre.toString().length;
      const end = start + selectedText.length;
      const containerText = container.textContent ?? "";
      setSelection({ quote: buildQuote(containerText, start, end), startOffset: start, endOffset: end });
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  // Re-apply highlights whenever the annotation set changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerText = container.textContent ?? "";
    const ranges: HighlightRange[] = [];
    for (const a of annotations) {
      const loc = locate(containerText, {
        exact: a.anchorExact ?? "",
        prefix: a.anchorPrefix ?? "",
        suffix: a.anchorSuffix ?? "",
      });
      if (loc) ranges.push({ id: a.id, start: loc.start, end: loc.end });
    }
    applyHighlights(container, ranges);
  }, [annotations]);

  const onContainerClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const mark = target.closest("mark[data-annotation-id]");
    if (mark) setFocusedId(mark.getAttribute("data-annotation-id"));
  }, []);

  async function submitComment() {
    if (!selection || !pendingBody.trim()) return;
    const res = await fetch(`/api/documents/${doc.id}/annotations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quote: selection.quote,
        startOffset: selection.startOffset,
        endOffset: selection.endOffset,
        body: pendingBody,
      }),
    });
    if (res.status === 201) {
      const { annotation } = await res.json();
      const created: ClientAnnotation = {
        id: annotation.id,
        anchorExact: annotation.anchorExact,
        anchorPrefix: annotation.anchorPrefix,
        anchorSuffix: annotation.anchorSuffix,
        startOffset: annotation.startOffset,
        endOffset: annotation.endOffset,
        threadStatus: annotation.threadStatus,
        comments: (annotation.comments ?? []).map((c: ClientComment) => ({ id: c.id, body: c.body, author: c.author })),
      };
      setAnnotations((prev) => [...prev, created]);
      setSelection(null);
      setPendingBody("");
      setFocusedId(created.id);
    }
  }

  const addComment = useCallback(async (annotationId: string, body: string) => {
    const res = await fetch(`/api/annotations/${annotationId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (res.status === 201) {
      const { comment } = await res.json();
      setAnnotations((prev) =>
        prev.map((a) =>
          a.id === annotationId ? { ...a, comments: [...a.comments, { id: comment.id, body: comment.body, author: comment.author }] } : a
        )
      );
    }
  }, []);

  const toggleThread = useCallback(async (annotationId: string, nextStatus: string) => {
    const res = await fetch(`/api/annotations/${annotationId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadStatus: nextStatus }),
    });
    if (res.ok) {
      setAnnotations((prev) => prev.map((a) => (a.id === annotationId ? { ...a, threadStatus: nextStatus } : a)));
    }
  }, []);

  async function submitReview(verdict: "APPROVE" | "REQUEST_CHANGES") {
    const res = await fetch(`/api/documents/${doc.id}/reviews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verdict }),
    });
    if (res.ok) {
      const { state } = await res.json();
      setDocState(state);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl gap-6 px-4 py-8">
      <div className="min-w-0 flex-1">
        <h1 className="mb-4 text-2xl font-semibold">{doc.title}</h1>
        <div
          ref={containerRef}
          data-testid="doc-body"
          onClick={onContainerClick}
          className="prose max-w-none rounded border p-4"
        >
          <RenderedMarkdown markdown={doc.markdown} />
        </div>
      </div>

      <aside className="flex w-80 shrink-0 flex-col gap-4">
        <div className="flex items-center justify-between gap-2 rounded border p-3">
          <span data-testid="doc-state" className="rounded bg-gray-100 px-2 py-1 text-sm">
            {STATE_LABELS[docState] ?? docState}
          </span>
          <div className="flex gap-2">
            <button onClick={() => submitReview("APPROVE")} className="rounded bg-green-600 px-2 py-1 text-sm text-white">
              Approve
            </button>
            <button onClick={() => submitReview("REQUEST_CHANGES")} className="rounded bg-red-600 px-2 py-1 text-sm text-white">
              Request changes
            </button>
          </div>
        </div>

        {selection && (
          <div className="flex flex-col gap-2 rounded border p-3">
            <p className="text-xs text-gray-500">Commenting on: “{selection.quote.exact.slice(0, 60)}”</p>
            <textarea
              aria-label="comment"
              value={pendingBody}
              onChange={(e) => setPendingBody(e.target.value)}
              rows={3}
              className="border p-2 text-sm"
              placeholder="Add a comment"
            />
            <div className="flex gap-2">
              <button onClick={submitComment} className="rounded bg-black px-2 py-1 text-sm text-white">
                Comment
              </button>
              <button
                onClick={() => {
                  setSelection(null);
                  setPendingBody("");
                }}
                className="rounded border px-2 py-1 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <CommentSidebar
          annotations={annotations}
          focusedId={focusedId}
          onSelectThread={setFocusedId}
          onAddComment={addComment}
          onToggleThread={toggleThread}
        />
      </aside>
    </div>
  );
}
