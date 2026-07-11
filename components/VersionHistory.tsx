"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DiffRow } from "@/lib/diff";
import { DiffLegend, DiffRowsView } from "@/components/DiffRows";

interface VersionMeta { versionNumber: number; createdAt: string | Date; contentHash: string; createdBy: { name: string }; }

export function VersionHistory({
  documentId, versions, from, to, rows, singleMarkdown,
}: { documentId: string; versions: VersionMeta[]; from: number; to: number; rows: DiffRow[] | null; singleMarkdown: string | null; }) {
  const router = useRouter();
  const numbers = versions.map((v) => v.versionNumber);
  const nav = (f: number, t: number) => router.push(`/documents/${documentId}/history?from=${f}&to=${t}`);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Version history</h1>
        <Link href={`/documents/${documentId}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
          Back to document
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="text-muted">Compare</label>
        <select data-testid="from-select" className="rounded-[var(--radius-app)] border border-border bg-surface px-2 py-1"
          value={from} onChange={(e) => nav(Number(e.target.value), to)}>
          {numbers.map((n) => <option key={n} value={n}>v{n}</option>)}
        </select>
        <span className="text-muted">→</span>
        <select data-testid="to-select" className="rounded-[var(--radius-app)] border border-border bg-surface px-2 py-1"
          value={to} onChange={(e) => nav(from, Number(e.target.value))}>
          {numbers.map((n) => <option key={n} value={n}>v{n}</option>)}
        </select>
      </div>

      {singleMarkdown !== null ? (
        <p className="text-sm text-muted">Only one version exists — no earlier version to compare.</p>
      ) : rows ? (
        <>
        <DiffLegend />
        <DiffRowsView rows={rows} from={from} to={to} />
        </>
      ) : (
        <p className="text-sm text-muted">Select two different versions to compare.</p>
      )}
    </div>
  );
}
