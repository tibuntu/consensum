import Link from "next/link";
import { listDocuments, listReviewQueue } from "@/lib/documents";
import NewDocumentForm from "@/components/NewDocumentForm";
import { Card } from "@/components/ui/Card";
import { Badge, stateTone } from "@/components/ui/Badge";
import { relativeTime } from "@/lib/time";

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
};

function DocCard({ doc, required }: { doc: QueueRow; required?: boolean }) {
  return (
    <Link href={`/documents/${doc.id}`}>
      <Card className="flex h-full flex-col gap-2 p-4 transition-colors hover:bg-primary-subtle">
        <div className="flex items-start justify-between gap-3">
          <span className="font-medium text-foreground">{doc.title}</span>
          <div className="flex shrink-0 items-center gap-2">
            {required && <Badge tone="changes">Required</Badge>}
            <Badge tone={stateTone(doc.state)}>
              {STATE_LABELS[doc.state] ?? doc.state}
            </Badge>
          </div>
        </div>
        <span className="text-sm text-muted">
          {doc.owner?.name ?? doc.owner?.email} · {relativeTime(doc.updatedAt)}
        </span>
      </Card>
    </Link>
  );
}

export async function DocumentsHome({ userId }: { userId: string }) {
  const [documents, queue] = await Promise.all([
    listDocuments(userId),
    listReviewQueue(userId),
  ]);

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
        {documents.length === 0 ? (
          <Card className="p-6 text-sm text-muted">
            No documents yet — create one below.
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {documents.map((doc) => (
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
