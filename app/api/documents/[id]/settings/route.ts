import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { resolveAccess } from "@/lib/authz";
import { parseRequiredApprovals } from "@/lib/approvals";
import { updateReviewSettings } from "@/lib/reviews";
import { setVisibility } from "@/lib/sharing";
import { VISIBILITIES, type Visibility } from "@/lib/enums";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const access = await resolveAccess(user.id, id);
  if (!access) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!access.canManage) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const hasApprovals = body?.requiredApprovals !== undefined;
  const hasGate = body?.requireBlockerResolution !== undefined;
  const hasVisibility = body?.visibility !== undefined;
  if (!body || (!hasApprovals && !hasGate && !hasVisibility)) {
    return NextResponse.json(
      { error: "requiredApprovals, requireBlockerResolution, or visibility required" },
      { status: 400 },
    );
  }
  let n: number | null = null;
  if (hasApprovals) {
    n = parseRequiredApprovals(body.requiredApprovals);
    if (n === null) return NextResponse.json({ error: "requiredApprovals must be an integer 1–10" }, { status: 400 });
  }
  if (hasGate && typeof body.requireBlockerResolution !== "boolean") {
    return NextResponse.json({ error: "requireBlockerResolution must be a boolean" }, { status: 400 });
  }
  if (hasVisibility && !VISIBILITIES.includes(body.visibility as Visibility)) {
    return NextResponse.json({ error: "visibility must be PRIVATE or LINK" }, { status: 400 });
  }
  const gate = hasGate ? (body.requireBlockerResolution as boolean) : undefined;
  // Visibility is orthogonal to the approval/blocker-gate settings and never
  // changes review outcomes, so it must not trigger a state recompute.
  const state =
    hasApprovals || hasGate
      ? await updateReviewSettings(user.id, id, {
          ...(n !== null ? { requiredApprovals: n } : {}),
          ...(gate !== undefined ? { requireBlockerResolution: gate } : {}),
        })
      : undefined;
  if (hasVisibility) await setVisibility(id, body.visibility as Visibility);
  return NextResponse.json({
    ok: true,
    ...(n !== null ? { requiredApprovals: n } : {}),
    ...(gate !== undefined ? { requireBlockerResolution: gate } : {}),
    ...(hasVisibility ? { visibility: body.visibility } : {}),
    ...(state !== undefined ? { state } : {}),
  });
}
