import { CopyButton } from "@/components/ui/CopyButton";

/** The copy-paste agent-setup snippet, shared by the tokens page and the
 *  first-run card on home. `tokenHint` adapts the placeholder comment to
 *  whether a freshly created token is visible on the same page. */
export function CliSetupBlock({
  baseUrl,
  tokenHint = "the token shown above",
  title,
}: {
  baseUrl: string;
  tokenHint?: string;
  title?: string;
}) {
  const snippet = `export CONSENSUM_BASE_URL="${baseUrl}"
export CONSENSUM_API_TOKEN="csm_…"   # ${tokenHint}
# /consensum-push-plan and /consensum-pull-feedback ship in this repo's dist/claude/commands/`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        {title ? <h2 className="text-lg font-semibold text-foreground">{title}</h2> : <span />}
        <CopyButton label="Copy commands" value={snippet} />
      </div>
      <pre className="overflow-x-auto rounded-[var(--radius-app)] border border-border bg-[var(--state-neutral-bg)] p-4 text-xs text-foreground">
        {snippet}
      </pre>
    </div>
  );
}
