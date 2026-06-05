"use client";
import { useState } from "react";
import type { ClientAnnotation } from "@/components/DocumentView";

function authorLabel(author?: { name?: string | null; email?: string | null } | null): string {
  return author?.name ?? author?.email ?? "You";
}

function ThreadCard({
  annotation,
  focused,
  onSelect,
  onAddComment,
  onToggleThread,
}: {
  annotation: ClientAnnotation;
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
          “{annotation.anchorExact.slice(0, 80)}”
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
  onSelectThread,
  onAddComment,
  onToggleThread,
}: {
  annotations: ClientAnnotation[];
  focusedId: string | null;
  onSelectThread: (id: string) => void;
  onAddComment: (annotationId: string, body: string) => Promise<void>;
  onToggleThread: (annotationId: string, nextStatus: string) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-gray-500">Comments</h2>
      {annotations.length === 0 ? (
        <p className="text-sm text-gray-400">Select text in the document to add a comment.</p>
      ) : (
        annotations.map((a) => (
          <ThreadCard
            key={a.id}
            annotation={a}
            focused={focusedId === a.id}
            onSelect={onSelectThread}
            onAddComment={onAddComment}
            onToggleThread={onToggleThread}
          />
        ))
      )}
    </div>
  );
}
