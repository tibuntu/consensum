import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { verifyToken } from "@/lib/tokens";

export async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

export async function requireApiUser(req: Request) {
  return verifyToken(req.headers.get("authorization"));
}
