import { Card } from "@/components/ui/Card";

// Suspense fallback for the document detail route — mirrors the body + sidebar
// layout so the page doesn't flash blank while the document loads.
export default function Loading() {
  return (
    <div className="flex w-full flex-col gap-6 lg:flex-row" aria-busy="true" aria-label="Loading document">
      <div className="min-w-0 flex-1">
        <div className="mb-4 h-8 w-1/2 animate-pulse rounded-[var(--radius-app)] bg-primary-subtle" />
        <Card className="flex min-h-[50vh] flex-col gap-3 p-6">
          <div className="h-4 w-3/4 animate-pulse rounded bg-primary-subtle" />
          <div className="h-4 w-full animate-pulse rounded bg-primary-subtle" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-primary-subtle" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-primary-subtle" />
          <div className="h-4 w-4/6 animate-pulse rounded bg-primary-subtle" />
        </Card>
      </div>
      <aside className="w-full shrink-0 lg:w-80">
        <Card className="h-28 animate-pulse p-3" />
      </aside>
    </div>
  );
}
