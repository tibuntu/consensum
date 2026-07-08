import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { isAdmin, listUsers, listAllowlist } from "@/lib/admin";
import { AdminUsers } from "@/components/AdminUsers";
import { AdminAllowlist } from "@/components/AdminAllowlist";

export default async function AdminPage() {
  const session = await getSession();
  if (!session || !isAdmin(session.user)) notFound();
  const [users, allowlist] = await Promise.all([listUsers(), listAllowlist()]);
  return (
    <div className="flex w-full max-w-3xl flex-col gap-8" data-testid="admin-page">
      <AdminUsers initial={users} selfId={session.user.id} />
      <AdminAllowlist env={allowlist.env} initial={allowlist.db} />
    </div>
  );
}
