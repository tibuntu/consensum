import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import InboxList from "@/components/InboxList";

export default async function InboxPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <InboxList />
  );
}
