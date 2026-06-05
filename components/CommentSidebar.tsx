"use client";
import { useState } from "react";
import type { ClientAnnotation } from "@/components/DocumentView";

function authorLabel(author?: { name?: string | null; email?: string | null } | null): string {
  return author?.name ?? author?.email ?? "You";
}

function ThreadCard({
  annotation,
  status,
  focused,
  onSelect,
  onAddComment,
  onToggleThread,
}: {
  annotation: ClientAnnotation;
  status?: string;
  focused: boolean;
  onSelect: (id: string) => void;
  onAddComment: (annotationId: string, body: string) => Promise<void>;
  onToggleThread: (annotationId: string, nextStatus: string) => Promise<void>;
}) {
  const [reply, setReply] = useState("");
  const resolved = annotation.threadStatus === "RESOLVED";

  async function submitReply() {
    if (!reply.trim()) return;
    await onAddComment(annotation.id, reply);
    setReply("");
  }

  return (
    <div
      data-testid="thread"
      onClick={() => onSelect(annotation.id)}
      className={`flex flex-col gap-2 rounded border p-3 ${resolved ? "opacity-50" : ""} ${focused ? "ring-2 ring-blue-400" : ""}`}
    >
      {annotation.anchorExact && (
        <p className="border-l-2 border-yellow-400 pl-2 text-xs italic text-gray-600">
          &ldquo;{annotation.anchorExact.slice(0, 80)}&rdquo;
          {status === "MOVED" && <span className="text-xs text-orange-600"> moved</span>}
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {annotation.comments.map((c) => (
          <li key={c.id} className="text-sm">
            <span className="font-medium">{authorLabel(c.author)}: </span>
            {c.body}
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1">
        <textarea
          aria-label="reply"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={2}
          className="border p-1 text-sm"
          placeholder="Reply"
        />
        <div className="flex gap-2">
          <button onClick={submitReply} className="rounded bg-black px-2 py-1 text-xs text-white">
            Reply
          </button>
          <button
            onClick={() => onToggleThread(annotation.id, resolved ? "OPEN" : "RESOLVED")}
            className="rounded border px-2 py-1 text-xs"
          >
            {resolved ? "Reopen" : "Resolve"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CommentSidebar({
  annotations,
  focusedId,
  statusById,
  onSelectThread,
  onAddComment,
  onToggleThread,
}: {
  annotations: ClientAnnotation[];
  focusedId: string | null;
  statusById: Record<string, string>;
  onSelectThread: (id: string) => void;
  onAddComment: (annotationId: string, body: string) => Promise<void>;
  onToggleThread: (annotationId: string, nextStatus: string) => Promise<void>;
}) {
  const orphaned = annotations.filter((a) => statusById[a.id] === "ORPHANED");
  const live = annotations.filter((a) => statusById[a.id] !== "ORPHANED");

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-gray-500">Comments</h2>
      {live.length === 0 && orphaned.length === 0 ? (
        <p className="text-sm text-gray-400">Select text in the document to add a comment.</p>
      ) : (
        <>
          {live.map((a) => (
            <ThreadCard
              key={a.id}
              annotation={a}
              status={statusById[a.id]}
              focused={focusedId === a.id}
              onSelect={onSelectThread}
              onAddComment={onAddComment}
              onToggleThread={onToggleThread}
            />
          ))}
          {orphaned.length > 0 && (
            <div data-testid="orphaned-section" className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase text-gray-400">Orphaned comments</h3>
              {orphaned.map((a) => (
                <ThreadCard key={a.id} annotation={a} status="ORPHANED" focused={focusedId === a.id}
                  onSelect={onSelectThread} onAddComment={onAddComment} onToggleThread={onToggleThread} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
