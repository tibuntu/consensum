import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { ensureParticipant } from "@/lib/authz";
import { listVersions, getVersionMarkdown } from "@/lib/versions";
import { diffMarkdown } from "@/lib/diff";
import { VersionHistory } from "@/components/VersionHistory";

export default async function HistoryPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  if (!(await ensureParticipant(session.user.id, id))) notFound();

  const versions = await listVersions(id); // newest-first
  if (versions.length === 0) notFound();

  const numbers = versions.map((v) => v.versionNumber);
  const sp = await searchParams;
  const latest = numbers[0];
  const prev = numbers[1] ?? latest;
  const to = clamp(Number(sp.to) || latest, numbers);
  const from = clamp(Number(sp.from) || prev, numbers);

  let rows = null;
  if (from !== to) {
    const [oldMd, newMd] = await Promise.all([getVersionMarkdown(id, from), getVersionMarkdown(id, to)]);
    rows = diffMarkdown(oldMd ?? "", newMd ?? "");
  }
  const single = versions.length === 1 ? await getVersionMarkdown(id, latest) : null;

  return <VersionHistory documentId={id} versions={versions} from={from} to={to} rows={rows} singleMarkdown={single} />;
}

function clamp(n: number, valid: number[]): number {
  return valid.includes(n) ? n : valid[0];
}
