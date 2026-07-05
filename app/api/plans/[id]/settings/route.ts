import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { isOwner } from "@/lib/authz";
import { parseRequiredApprovals } from "@/lib/approvals";
import { setRequiredApprovals, setRequireBlockerResolution } from "@/lib/reviews";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authd = await requireApiUser(req);
  if (!authd) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isOwner(authd.user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!authd.scopes.includes("plans:write")) return NextResponse.json({ error: "insufficient scope" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const hasApprovals = body?.requiredApprovals !== undefined;
  const hasGate = body?.requireBlockerResolution !== undefined;
  if (!body || (!hasApprovals && !hasGate)) {
    return NextResponse.json({ error: "requiredApprovals or requireBlockerResolution required" }, { status: 400 });
  }
  let n: number | null = null;
  if (hasApprovals) {
    n = parseRequiredApprovals(body.requiredApprovals);
    if (n === null) return NextResponse.json({ error: "requiredApprovals must be an integer 1–10" }, { status: 400 });
  }
  if (hasGate && typeof body.requireBlockerResolution !== "boolean") {
    return NextResponse.json({ error: "requireBlockerResolution must be a boolean" }, { status: 400 });
  }
  let state = "";
  if (n !== null) state = await setRequiredApprovals(authd.user.id, id, n);
  if (hasGate) state = await setRequireBlockerResolution(authd.user.id, id, body.requireBlockerResolution);
  return NextResponse.json({
    ...(n !== null ? { requiredApprovals: n } : {}),
    ...(hasGate ? { requireBlockerResolution: body.requireBlockerResolution as boolean } : {}),
    state,
  });
}
