import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { DocumentsHome } from "@/components/DocumentsHome";

// Served at "/" for signed-in users via the rewrite in proxy.ts.
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; archived?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { tag, archived } = await searchParams;
  return <DocumentsHome userId={session.user.id} activeTag={tag} showArchived={archived === "1"} />;
}
