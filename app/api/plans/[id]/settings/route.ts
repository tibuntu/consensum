import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { resolveAccess } from "@/lib/authz";
import { parseRequiredApprovals } from "@/lib/approvals";
import { updateReviewSettings } from "@/lib/reviews";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authd = await requireApiUser(req);
  if (!authd.ok) return authd.response;
  const { id } = await params;
  const access = await resolveAccess(authd.user.id, id);
  if (!access?.canManage) return NextResponse.json({ error: "not found" }, { status: 404, headers: authd.headers });
  if (!authd.scopes.includes("plans:write")) return NextResponse.json({ error: "insufficient scope" }, { status: 403, headers: authd.headers });
  const body = await req.json().catch(() => null);
  const hasApprovals = body?.requiredApprovals !== undefined;
  const hasGate = body?.requireBlockerResolution !== undefined;
  if (!body || (!hasApprovals && !hasGate)) {
    return NextResponse.json({ error: "requiredApprovals or requireBlockerResolution required" }, { status: 400, headers: authd.headers });
  }
  let n: number | null = null;
  if (hasApprovals) {
    n = parseRequiredApprovals(body.requiredApprovals);
    if (n === null) return NextResponse.json({ error: "requiredApprovals must be an integer 1–10" }, { status: 400, headers: authd.headers });
  }
  if (hasGate && typeof body.requireBlockerResolution !== "boolean") {
    return NextResponse.json({ error: "requireBlockerResolution must be a boolean" }, { status: 400, headers: authd.headers });
  }
  const gate = hasGate ? (body.requireBlockerResolution as boolean) : undefined;
  const state = await updateReviewSettings(authd.user.id, id, {
    ...(n !== null ? { requiredApprovals: n } : {}),
    ...(gate !== undefined ? { requireBlockerResolution: gate } : {}),
  });
  return NextResponse.json({
    ...(n !== null ? { requiredApprovals: n } : {}),
    ...(gate !== undefined ? { requireBlockerResolution: gate } : {}),
    state,
  }, { headers: authd.headers });
}
