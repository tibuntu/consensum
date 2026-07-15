import Link from "next/link";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ThemeToggle } from "@/components/ThemeToggle";

// Staggered entrance delay for the hero scene; consumed by the lp-* classes below.
const at = (d: string) => ({ "--d": d }) as CSSProperties;

/* The hero plays the product loop once, CSS-only: push → comment → changes
   requested → pull → revision → approved. Under prefers-reduced-motion the
   global rules zero the durations and the override below zeroes the delays,
   so the scene renders instantly in its final (approved) state. */
const SCENE_CSS = `
@keyframes lp-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
@keyframes lp-out { to { opacity: 0; } }
@keyframes lp-mark { to { background: var(--highlight-bg); color: var(--highlight-fg); } }
.lp-seq { opacity: 0; animation: lp-in 0.45s ease-out var(--d, 0s) forwards; }
.lp-gone { animation: lp-out 0.3s ease var(--d, 0s) forwards; }
.lp-flash { opacity: 0; animation: lp-in 0.3s ease var(--d1) forwards, lp-out 0.3s ease var(--d2) forwards; }
.lp-mark { border-radius: 0.125rem; padding: 0 0.15rem; animation: lp-mark 0.4s ease var(--d, 0s) forwards; }
@media (prefers-reduced-motion: reduce) {
  .lp-seq, .lp-gone, .lp-flash, .lp-mark { animation-delay: 0s !important; }
}
`;

const STEPS: { actor: string; team?: boolean; title: string; body: string; chip: ReactNode }[] = [
  {
    actor: "Agent",
    title: "Push the plan",
    body: "Claude Code drafts the approach and pushes it for review with one command.",
    chip: <code className="rounded bg-[var(--state-neutral-bg)] px-2 py-1 font-mono text-xs text-[var(--state-neutral)]">/consensum-push-plan</code>,
  },
  {
    actor: "Team",
    team: true,
    title: "Review it like a PR",
    body: "Select text to comment, thread the discussion, and vote — asynchronously, before anything is built.",
    chip: (
      <span className="flex flex-wrap gap-2">
        <Badge tone="approved">Approve</Badge>
        <Badge tone="changes">Request changes</Badge>
      </span>
    ),
  },
  {
    actor: "Agent",
    title: "Pull the verdict",
    body: "The agent pulls the consolidated feedback, revises the plan, and only then starts writing code.",
    chip: <code className="rounded bg-[var(--state-neutral-bg)] px-2 py-1 font-mono text-xs text-[var(--state-neutral)]">/consensum-pull-feedback</code>,
  },
];

function ReviewScene() {
  return (
    <div className="w-full max-w-md lg:justify-self-end">
      <div className="rounded-[var(--radius-app)] border border-white/10 bg-[#14111e] p-4 font-mono text-xs leading-relaxed shadow-sm">
        <div className="mb-3 flex items-center gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="ml-2 text-[10px] text-[#8b86a0]">claude code</span>
        </div>
        <p className="lp-seq text-[#e6e1f2]" style={at("0.2s")}><span className="text-[#a78bfa]">❯</span> /consensum-push-plan</p>
        <p className="lp-seq text-[#8b86a0]" style={at("0.9s")}>✓ pushed — 2 reviewers notified</p>
        <p className="lp-seq mt-2 text-[#e6e1f2]" style={at("4.6s")}><span className="text-[#a78bfa]">❯</span> /consensum-pull-feedback</p>
        <p className="lp-seq text-[#8b86a0]" style={at("5.2s")}>↳ changes requested — revision pushed</p>
      </div>

      <div className="lp-seq mt-3 rounded-[var(--radius-app)] border border-border bg-surface p-5 shadow-sm" style={at("1.4s")}>
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-sm font-semibold text-foreground">Q3 platform migration</span>
          <span className="grid justify-items-end">
            <Badge tone="open" className="lp-gone [grid-area:1/1]" style={at("3.6s")}>Open</Badge>
            <Badge tone="changes" className="lp-flash [grid-area:1/1]" style={{ "--d1": "3.7s", "--d2": "6s" } as CSSProperties}>Changes requested</Badge>
            <Badge tone="approved" className="lp-seq [grid-area:1/1]" style={at("6.2s")}>Approved</Badge>
          </span>
        </div>
        <div className="mt-4 space-y-1.5 text-sm text-foreground">
          <p><span className="text-muted">1.</span> Freeze schema changes at the release cut.</p>
          <p><span className="text-muted">2.</span> Migrate the billing worker <span className="lp-mark" style={at("2.4s")}>during the cutover window</span>.</p>
        </div>
        <div className="lp-seq mt-3 border-l-2 border-primary pl-3" style={at("2.9s")}>
          <p className="text-xs font-semibold text-foreground">
            <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary font-mono text-[9px] font-semibold text-primary-fg">M</span>
            Mira
          </p>
          <p className="mt-0.5 text-xs text-muted">Which queue drains first? Make the order explicit before we approve.</p>
        </div>
        <div className="lp-seq mt-4" style={at("5.6s")}>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted">rev 2 · diff</p>
          <div className="mt-1.5 space-y-px font-mono text-xs">
            <p className="rounded-sm bg-[var(--state-changes-bg)] px-2 py-1 text-[var(--state-changes)]">- Migrate the billing worker during the cutover window.</p>
            <p className="rounded-sm bg-[var(--state-approved-bg)] px-2 py-1 text-[var(--state-approved)]">+ Drain jobs-legacy first, then migrate the billing worker.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Signed-in users never see this page: proxy.ts rewrites "/" to the documents
// dashboard when a session cookie is present.
export default function Index() {
  return (
    <div className="flex min-h-screen flex-col">
      <style>{SCENE_CSS}</style>
      <header className="border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <span className="font-mono font-semibold text-foreground">◆ Consensum</span>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/login"><Button variant="ghost" size="sm">Log in</Button></Link>
            <Link href="/register"><Button size="sm">Sign up</Button></Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-20 sm:py-24 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-wider text-muted">
              agent → <span className="text-primary">team</span> → agent
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight text-balance text-foreground sm:text-5xl">
              The code review that happens <span className="annotation-highlight px-1">before the code</span>.
            </h1>
            <p className="mt-5 max-w-md text-lg text-muted">
              Your agent drafts the plan and pushes it straight from Claude Code. Your team comments
              on the text, requests changes, and approves. The consolidated verdict flows back into
              the agent before it writes a line.
            </p>
            <div className="mt-8 flex gap-3">
              <Link href="/register"><Button>Get started</Button></Link>
              <Link href="/login"><Button variant="secondary">Log in</Button></Link>
            </div>
          </div>
          <ReviewScene />
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 pb-24 pt-8">
          <p className="font-mono text-xs font-semibold uppercase tracking-wider text-muted">The loop</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            One human review between two agent runs.
          </h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:gap-6">
            {STEPS.map((s, i) => (
              <Fragment key={i}>
                {i > 0 && (
                  <span className="hidden self-start pt-4 font-mono text-muted sm:block" aria-hidden>
                    →
                  </span>
                )}
                <div className={`border-t-2 pt-4 ${s.team ? "border-primary" : "border-border"}`}>
                  <p className={`font-mono text-[11px] font-semibold uppercase tracking-wider ${s.team ? "text-primary" : "text-muted"}`}>
                    {s.actor}
                  </p>
                  <h3 className="mt-2 font-semibold text-foreground">{s.title}</h3>
                  <p className="mt-1 text-sm text-muted">{s.body}</p>
                  <div className="mt-3">{s.chip}</div>
                </div>
              </Fragment>
            ))}
          </div>
        </section>

        <p className="mx-auto max-w-5xl px-6 pb-16 text-center font-mono text-xs leading-relaxed text-muted">
          Anchored comments · Approve / request changes · Version history & diffs · Notifications & webhooks · Self-hosted
        </p>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-6 text-center text-sm text-muted">
          <span className="font-mono">◆ Consensum — review the plan, then build.</span>
        </div>
      </footer>
    </div>
  );
}
