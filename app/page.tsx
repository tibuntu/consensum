import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ThemeToggle } from "@/components/ThemeToggle";

const STEPS = [
  {
    step: "1",
    title: "Push the plan",
    body: "Your agent runs /consensum-push-plan and the proposal lands in Consensum as a reviewable document.",
  },
  {
    step: "2",
    title: "Review together",
    body: "Your team reads it, selects text to comment, threads discussion, and votes Approve or Request changes.",
  },
  {
    step: "3",
    title: "Pull feedback",
    body: "The agent runs /consensum-pull-feedback, receives consolidated decisions, and revises before writing any code.",
  },
];

export default async function Index() {
  const session = await getSession();
  if (session) redirect("/app");
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <span className="font-mono font-semibold text-foreground">◆ Consensum</span>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/login"><Button variant="ghost" size="sm">Log in</Button></Link>
            <Link href="/register"><Button size="sm">Sign up</Button></Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-6 py-24 text-center sm:py-32">
          <span className="rounded-full border border-border bg-primary-subtle px-3 py-1 font-mono text-xs font-semibold uppercase tracking-wider text-primary">
            Plan review for the age of agents
          </span>
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Pull-request review, but for the plan — before the agent builds.
          </h1>
          <p className="max-w-xl text-lg text-muted">
            Your agent drafts a plan; your team reviews and refines it asynchronously; consolidated
            feedback flows back into the agent before a line of code is written.
          </p>
          <div className="flex gap-3">
            <Link href="/register"><Button>Get started</Button></Link>
            <Link href="/login"><Button variant="secondary">Log in</Button></Link>
          </div>
          <div className="mt-8 w-full max-w-lg">
            <div className="rounded-[var(--radius-app)] border border-border bg-surface p-5 text-left shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-sm font-semibold text-foreground">Q3 Platform Roadmap</span>
                <Badge tone="approved">Approved</Badge>
              </div>
              <div className="mt-4 space-y-2" aria-hidden>
                <div className="h-2 w-5/6 rounded bg-primary-subtle" />
                <div className="h-2 w-full rounded bg-primary-subtle" />
                <div className="h-2 w-2/3 rounded bg-primary-subtle" />
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs text-muted">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary font-mono text-[10px] font-semibold text-primary-fg">BL</span>
                <span>Blair approved · 2 of 2 reviewers</span>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-24">
          <h2 className="mb-6 text-center font-mono text-xs font-semibold uppercase tracking-wider text-muted">How it works</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((s) => (
              <Card key={s.step} className="flex flex-col gap-3 p-6">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-subtle font-mono text-sm font-semibold text-primary">
                  {s.step}
                </span>
                <h3 className="font-semibold text-foreground">{s.title}</h3>
                <p className="text-sm text-muted">{s.body}</p>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-6 text-center text-sm text-muted">
          <span className="font-mono">◆ Consensum — review the plan, then build.</span>
        </div>
      </footer>
    </div>
  );
}
