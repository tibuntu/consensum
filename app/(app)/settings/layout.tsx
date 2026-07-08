import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { SettingsNav } from "@/components/SettingsNav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const admin = session ? isAdmin(session.user) : false;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <SettingsNav isAdmin={admin} />
      {children}
    </div>
  );
}
