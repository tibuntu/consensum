import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Button } from "@/components/ui/Button";

export default async function Index() {
  const session = await getSession();
  if (session) redirect("/app");
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-6 text-center">
      <span className="text-sm font-semibold text-primary">◆ Quorum AI</span>
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
    </main>
  );
}
