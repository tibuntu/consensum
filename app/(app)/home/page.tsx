import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { DocumentsHome } from "@/components/DocumentsHome";

// Served at "/" for signed-in users via the rewrite in proxy.ts.
export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <DocumentsHome userId={session.user.id} />;
}
