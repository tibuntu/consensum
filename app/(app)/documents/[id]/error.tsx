"use client";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

// Route-level error boundary for the document detail page. Recoverable: `reset`
// re-renders the segment to retry the failed load.
export default function DocumentError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card role="alert" className="mx-auto mt-12 flex max-w-md flex-col items-start gap-3 p-6">
      <h1 className="text-lg font-semibold text-foreground">Couldn&apos;t load this document</h1>
      <p className="text-sm text-muted">
        Something went wrong while loading this document. It may be a temporary problem — try again.
      </p>
      <Button variant="primary" size="sm" onClick={() => reset()}>
        Try again
      </Button>
    </Card>
  );
}
