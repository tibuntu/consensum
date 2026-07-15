"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type Role = "REVIEWER" | "VIEWER";

interface Participant {
  userId: string;
  name: string | null;
  email: string;
  role: string;
  isOwner: boolean;
  required: boolean;
}

export default function ShareDialog({
  documentId,
  visibility: initialVisibility,
  tags: initialTags,
  onTagsChange,
  onVisibilityChange,
  onClose,
}: {
  documentId: string;
  visibility: string;
  tags: string[];
  onTagsChange?: (tags: string[]) => void;
  onVisibilityChange?: (v: string) => void;
  onClose: () => void;
}) {
  const [visibility, setVisibility] = useState(initialVisibility);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [tagInput, setTagInput] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagError, setTagError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("REVIEWER");
  const [addRequired, setAddRequired] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/documents/${documentId}/participants`);
    if (res.ok) {
      const data = await res.json();
      setParticipants(data.participants ?? []);
    }
    setLoading(false);
  }, [documentId]);

  useEffect(() => {
    // One-shot fetch on mount/documentId change; `load` only ever runs from
    // here or after a mutation, so there's no cascading-render risk.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/tags")
      .then(async (r) => {
        if (r.ok) setAllTags((await r.json()).tags ?? []);
      })
      .catch(() => {});
  }, []);

  async function saveTags(next: string[]) {
    const previous = tags;
    setTags(next);
    setTagError(null);
    const res = await fetch(`/api/documents/${documentId}/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags: next }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setTags(previous);
      setTagError("Couldn't update tags. Please try again.");
      return;
    }
    const data = await res.json();
    const saved: string[] = data.tags ?? next;
    setTags(saved);
    onTagsChange?.(saved);
  }

  function addTag() {
    const name = tagInput.trim().toLowerCase();
    setTagInput("");
    if (!name || tags.includes(name)) return;
    saveTags([...tags, name]);
  }

  async function changeVisibility(next: string) {
    const previous = visibility;
    setVisibility(next);
    setManageError(null);
    const res = await fetch(`/api/documents/${documentId}/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility: next }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setVisibility(previous);
      setManageError("Couldn't change visibility. Please try again.");
      return;
    }
    onVisibilityChange?.(next);
  }

  async function invite() {
    if (!email.trim()) return;
    setInviteError(null);
    setInviting(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/participants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role, required: role === "REVIEWER" ? addRequired : false }),
      });
      if (res.status === 409) {
        setInviteError("No account for that email");
        return;
      }
      if (!res.ok) {
        setInviteError("Couldn't add that participant.");
        return;
      }
      setEmail("");
      setRole("REVIEWER");
      setAddRequired(false);
      await load();
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(userId: string, nextRole: Role) {
    setManageError(null);
    const res = await fetch(`/api/documents/${documentId}/participants/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: nextRole }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setManageError("Couldn't update that role. Please try again.");
    }
    await load();
  }

  async function changeRequired(userId: string, next: boolean) {
    setManageError(null);
    const res = await fetch(`/api/documents/${documentId}/participants/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ required: next }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setManageError("Couldn't update required status. Please try again.");
    }
    await load();
  }

  async function removeParticipant(userId: string) {
    if (!confirm("Remove this participant from the document?")) return;
    setManageError(null);
    const res = await fetch(`/api/documents/${documentId}/participants/${userId}`, { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) {
      setManageError("Couldn't remove that participant. Please try again.");
    }
    await load();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <Card
        role="dialog"
        aria-label="Share document"
        aria-modal="true"
        className="flex w-full max-w-md flex-col gap-4 p-6"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Share document</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <label className="flex flex-col gap-1 text-sm text-foreground">
          Visibility
          <select
            aria-label="visibility"
            value={visibility}
            onChange={(e) => changeVisibility(e.target.value)}
            className="rounded-[var(--radius-app)] border border-border bg-surface px-2 py-1 text-sm text-foreground"
          >
            <option value="PRIVATE">Private</option>
            <option value="LINK">Anyone with link</option>
          </select>
        </label>

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <span className="text-sm font-medium text-foreground">Tags</span>
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <span
                key={t}
                data-testid={`tag-${t}`}
                className="inline-flex items-center gap-1 rounded-full bg-primary-subtle px-2 py-0.5 text-xs text-foreground"
              >
                {t}
                <button aria-label={`remove tag ${t}`} onClick={() => saveTags(tags.filter((x) => x !== t))}>
                  ×
                </button>
              </span>
            ))}
            {tags.length === 0 && <span className="text-xs text-muted">No tags yet.</span>}
          </div>
          <div className="flex gap-2">
            <input
              aria-label="new tag"
              list="all-tag-suggestions"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="add a tag"
              className="min-w-0 flex-1 rounded-[var(--radius-app)] border border-border bg-surface px-2 py-1 text-sm text-foreground"
            />
            <datalist id="all-tag-suggestions">
              {allTags.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <Button size="sm" onClick={addTag} disabled={!tagInput.trim()}>
              Add
            </Button>
          </div>
          {tagError && (
            <p role="alert" className="text-sm text-danger">
              {tagError}
            </p>
          )}
        </div>

        {manageError && (
          <p role="alert" className="text-sm text-danger">
            {manageError}
          </p>
        )}

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <span className="text-sm font-medium text-foreground">Add someone</span>
          <div className="flex gap-2">
            <input
              type="email"
              aria-label="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@example.com"
              className="min-w-0 flex-1 rounded-[var(--radius-app)] border border-border bg-surface px-2 py-1 text-sm text-foreground"
            />
            <select
              aria-label="role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="rounded-[var(--radius-app)] border border-border bg-surface px-2 py-1 text-sm text-foreground"
            >
              <option value="REVIEWER">Reviewer</option>
              <option value="VIEWER">Viewer</option>
            </select>
            <label className="flex items-center gap-1 text-sm text-foreground">
              <input
                type="checkbox"
                aria-label="required reviewer"
                checked={addRequired}
                disabled={role !== "REVIEWER"}
                onChange={(e) => setAddRequired(e.target.checked)}
              />
              Required
            </label>
            <Button size="sm" onClick={invite} disabled={inviting || !email.trim()}>
              Share
            </Button>
          </div>
          {inviteError && (
            <p role="alert" className="text-sm text-danger">
              {inviteError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <span className="text-sm font-medium text-foreground">People with access</span>
          {loading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {participants.map((p) => (
                <li key={p.userId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-foreground">{p.name || p.email}</span>
                  {p.isOwner ? (
                    <span className="shrink-0 text-xs text-muted">Owner</span>
                  ) : (
                    <div className="flex shrink-0 items-center gap-2">
                      <select
                        aria-label={`role for ${p.email}`}
                        value={p.role}
                        onChange={(e) => changeRole(p.userId, e.target.value as Role)}
                        className="rounded-[var(--radius-app)] border border-border bg-surface px-1.5 py-1 text-sm text-foreground"
                      >
                        <option value="REVIEWER">Reviewer</option>
                        <option value="VIEWER">Viewer</option>
                      </select>
                      {p.role === "REVIEWER" && (
                        <label className="flex items-center gap-1 text-xs text-muted">
                          <input
                            type="checkbox"
                            aria-label={`required for ${p.email}`}
                            checked={p.required}
                            onChange={(e) => changeRequired(p.userId, e.target.checked)}
                          />
                          Required
                        </label>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-[var(--danger)]"
                        onClick={() => removeParticipant(p.userId)}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
