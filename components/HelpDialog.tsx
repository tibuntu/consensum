"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CliSetupBlock } from "@/components/CliSetupBlock";
import { CopyButton } from "@/components/ui/CopyButton";

const INSTALL_CMD =
  "curl -fsSL https://raw.githubusercontent.com/tibuntu/consensum/main/scripts/install.sh | bash";

/** The nav "?" button plus the getting-started modal it opens — the README's
 *  setup instructions, reachable from every page. */
export function HelpDialog({ baseUrl }: { baseUrl: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        aria-label="Help"
        data-testid="help-button"
        onClick={() => setOpen(true)}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-sm text-muted transition-colors hover:border-primary/40 hover:text-foreground"
      >
        ?
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card
            role="dialog"
            aria-label="Getting started"
            aria-modal="true"
            data-testid="help-dialog"
            className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto p-6"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Getting started</h2>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
            <p className="text-sm text-muted">
              Consensum reviews your agent&apos;s plan before it implements: push a plan from
              Claude Code, the team reviews it here, and the consolidated feedback flows back
              into the agent.
            </p>
            <ol className="flex list-decimal flex-col gap-4 pl-5 text-sm text-foreground">
              <li>
                <div className="flex items-center justify-between gap-2">
                  <span>Install the Claude Code slash commands:</span>
                  <CopyButton label="Copy" value={INSTALL_CMD} />
                </div>
                <pre className="mt-2 overflow-x-auto rounded-[var(--radius-app)] border border-border bg-[var(--state-neutral-bg)] p-4 text-xs text-foreground">
                  {INSTALL_CMD}
                </pre>
              </li>
              <li>
                Create an API token under{" "}
                <a href="/settings/tokens" className="text-primary underline underline-offset-2">
                  Settings → API tokens
                </a>
                , then point your agent at this instance:
                <div className="mt-2">
                  <CliSetupBlock baseUrl={baseUrl} tokenHint="paste your token here" />
                </div>
              </li>
              <li>
                Run <code className="font-mono text-[0.95em]">/consensum-push-plan</code> in
                Claude Code — the plan appears on the Documents page for review. After the
                team weighs in, <code className="font-mono text-[0.95em]">/consensum-pull-feedback</code>{" "}
                pulls the consolidated verdict back into the agent.
              </li>
            </ol>
            <p className="border-t border-border pt-3 text-sm text-muted">
              Full setup, the auto-proceed hook, and the machine-API reference:{" "}
              <a
                href="https://github.com/tibuntu/consensum/blob/main/docs/agent-integration.md"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2"
              >
                agent-integration docs
              </a>
              .
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
