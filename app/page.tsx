import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function Index() {
  const session = await getSession();
  redirect(session ? "/app" : "/login");
}
