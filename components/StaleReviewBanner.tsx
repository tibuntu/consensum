"use client";
import { useState } from "react";
import type { DiffRow } from "@/lib/diff";
import { DiffRowsView } from "@/components/DiffRows";
import { Button } from "@/components/ui/Button";

export default function StaleReviewBanner({ documentId, reviewedVersion, currentVersion }: {
  documentId: string; reviewedVersion: number; currentVersion: number;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DiffRow[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/documents/${documentId}/diff?from=${reviewedVersion}&to=${currentVersion}`);
      if (!res.ok) throw new Error("diff fetch failed");
      setRows((await res.json()).rows);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && rows === null && !loading) void load();
  };

  return (
    <div data-testid="stale-review-banner" className="flex flex-col gap-2 rounded-[var(--radius-app)] border border-border bg-[var(--state-neutral-bg)] p-3 text-sm text-foreground">
      <div className="flex items-center justify-between gap-2">
        <span>You reviewed v{reviewedVersion} · document is now v{currentVersion}</span>
        <Button variant="secondary" size="sm" data-testid="stale-diff-toggle" onClick={toggle}>
          {open ? "Hide changes" : "Show changes"}
        </Button>
      </div>
      {open && (
        loading ? <p className="text-xs text-muted">Loading changes…</p>
        : error ? (
          <p className="text-xs text-muted">
            Couldn&apos;t load the changes.{" "}
            <button type="button" className="underline" onClick={() => void load()}>Retry</button>
          </p>
        )
        : rows && <DiffRowsView rows={rows} from={reviewedVersion} to={currentVersion} testId="stale-diff" />
      )}
    </div>
  );
}
