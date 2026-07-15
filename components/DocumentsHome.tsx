import Link from "next/link";
import { listDocuments, listReviewQueue, countVisibleDocuments } from "@/lib/documents";
import NewDocumentForm from "@/components/NewDocumentForm";
import { Card } from "@/components/ui/Card";
import { Badge, stateTone } from "@/components/ui/Badge";
import { relativeTime } from "@/lib/time";
import { baseUrl } from "@/lib/config";
import { CliSetupBlock } from "@/components/CliSetupBlock";

const STATE_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  OPEN: "Open",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
  CLOSED: "Closed",
};

type QueueRow = {
  id: string;
  title: string;
  state: string;
  updatedAt: Date;
  owner: { name: string | null; email: string } | null;
  reReview?: boolean;
  tags?: { tag: { name: string } }[];
  archivedAt?: Date | null;
};

function homeHref(tag: string | undefined, archived: boolean) {
  const p = new URLSearchParams();
  if (tag) p.set("tag", tag);
  if (archived) p.set("archived", "1");
  const qs = p.toString();
  return qs ? `/?${qs}` : "/";
}

function DocCard({ doc, required }: { doc: QueueRow; required?: boolean }) {
  return (
    <Link href={`/documents/${doc.id}`}>
      <Card className="flex h-full flex-col gap-2 p-4 transition-colors hover:bg-primary-subtle">
        <div className="flex items-start justify-between gap-3">
          <span className="font-medium text-foreground">{doc.title}</span>
          <div className="flex shrink-0 items-center gap-2">
            {doc.archivedAt && (
              <Badge tone="neutral" title={`archived ${relativeTime(doc.archivedAt)}`}>Archived</Badge>
            )}
            {doc.reReview && <Badge tone="neutral" data-testid="re-review-hint">Changed since your review</Badge>}
            {required && <Badge tone="changes">Required</Badge>}
            <Badge tone={stateTone(doc.state)}>
              {STATE_LABELS[doc.state] ?? doc.state}
            </Badge>
          </div>
        </div>
        {doc.tags && doc.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {doc.tags.map((t) => (
              <Badge key={t.tag.name} tone="neutral">{t.tag.name}</Badge>
            ))}
          </div>
        )}
        <span className="text-sm text-muted">
          {doc.owner?.name ?? doc.owner?.email} · {relativeTime(doc.updatedAt)}
        </span>
      </Card>
    </Link>
  );
}

export async function DocumentsHome({
  userId,
  activeTag,
  showArchived = false,
}: {
  userId: string;
  activeTag?: string;
  showArchived?: boolean;
}) {
  const [documents, queue] = await Promise.all([
    listDocuments(userId, { includeArchived: showArchived }),
    listReviewQueue(userId),
  ]);
  // A doc awaiting the caller's review is already surfaced in a queue section
  // above — listing it again under "Documents" reads as a duplicate.
  const queuedIds = new Set([...queue.blocking, ...queue.openReviews].map((d) => d.id));
  const rest = documents.filter((d) => !queuedIds.has(d.id));
  // Chips derive from the full (unfiltered-by-tag) list — deriving from a
  // filtered list would hide every other chip once one filter is active.
  const allTags = [...new Set(rest.flatMap((d) => d.tags.map((t) => t.tag.name)))].sort();
  const shown = activeTag ? rest.filter((d) => d.tags.some((t) => t.tag.name === activeTag)) : rest;
  const showGettingStarted =
    documents.length === 0 && !activeTag && (await countVisibleDocuments(userId)) === 0;

  return (
    <div className="flex flex-col gap-8">
      {queue.blocking.length > 0 && (
        <section className="flex flex-col gap-4" data-testid="queue-blocking">
          <h1 className="text-2xl font-semibold text-foreground">Blocking on you</h1>
          <div className="grid gap-4 sm:grid-cols-2">
            {queue.blocking.map((doc) => (
              <DocCard key={doc.id} doc={doc} required />
            ))}
          </div>
        </section>
      )}
      {queue.openReviews.length > 0 && (
        <section className="flex flex-col gap-4" data-testid="queue-open-reviews">
          <h2 className="text-xl font-semibold text-foreground">Open reviews</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {queue.openReviews.map((doc) => (
              <DocCard key={doc.id} doc={doc} />
            ))}
          </div>
        </section>
      )}
      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold text-foreground">Documents</h2>
        <div className="flex flex-wrap items-center gap-2" data-testid="doc-filter-bar">
          {allTags.map((t) => (
            <Link
              key={t}
              href={homeHref(activeTag === t ? undefined : t, showArchived)}
              data-testid={`tag-chip-${t}`}
              className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider ${
                activeTag === t
                  ? "bg-[var(--state-open-bg)] text-[var(--state-open)]"
                  : "bg-[var(--state-neutral-bg)] text-[var(--state-neutral)] hover:text-foreground"
              }`}
            >
              {t}
            </Link>
          ))}
          <Link
            href={homeHref(activeTag, !showArchived)}
            data-testid="toggle-archived"
            className="ml-auto text-sm text-muted hover:text-foreground"
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </Link>
        </div>
        {shown.length === 0 ? (
          showGettingStarted ? (
            <Card className="flex flex-col gap-4 p-6" data-testid="getting-started">
              <h3 className="text-lg font-semibold text-foreground">Get your first plan reviewed</h3>
              <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm text-foreground">
                <li>
                  <Link href="/settings/tokens" className="text-primary underline underline-offset-2">
                    Create an API token
                  </Link>
                </li>
                <li>
                  Point your agent at this instance:
                  <div className="mt-2">
                    <CliSetupBlock baseUrl={baseUrl()} tokenHint="paste your token here" />
                  </div>
                </li>
                <li>
                  Run <code className="font-mono text-[0.95em]">/consensum-push-plan</code> in Claude Code — the
                  plan appears here for review.
                </li>
              </ol>
              <p className="text-sm text-muted">Or create a document manually below.</p>
            </Card>
          ) : (
            <Card className="p-6 text-sm text-muted">
              {activeTag
                ? "No documents with this tag."
                : documents.length === 0
                  ? "No documents yet — create one below."
                  : "Nothing else — documents waiting on you are listed above."}
            </Card>
          )
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {shown.map((doc) => (
              <DocCard key={doc.id} doc={doc} />
            ))}
          </div>
        )}
      </section>
      <Card className="p-6">
        <NewDocumentForm />
      </Card>
    </div>
  );
}
