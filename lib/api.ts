import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { verifyToken } from "@/lib/tokens";
import { checkMachineRateLimit, rateHeaders } from "@/lib/rate-limit-machine";
import type { User } from "@/generated/prisma/client";

export async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

export type MachineAuth =
  | { ok: true; user: User; scopes: string[]; headers: Record<string, string> }
  | { ok: false; response: NextResponse };

/** Token auth + per-token budget for every /api/plans/** route. Invalid tokens
 *  are 401 and consume no budget; over-budget tokens get 429 + Retry-After. */
export async function requireApiUser(req: Request): Promise<MachineAuth> {
  const verified = await verifyToken(req.headers.get("authorization"));
  if (!verified) return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const rc = await checkMachineRateLimit(verified.tokenId);
  const rh = rateHeaders(rc);
  if (!rc.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "rate limit exceeded" },
        { status: 429, headers: { ...rh, "Retry-After": String(rc.retryAfterSec) } },
      ),
    };
  }
  return { ok: true, user: verified.user, scopes: verified.scopes, headers: rh };
}
