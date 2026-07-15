import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { resolveAccess } from "@/lib/authz";
import { parseRequiredApprovals } from "@/lib/approvals";
import { updateReviewSettings } from "@/lib/reviews";
import { setVisibility } from "@/lib/sharing";
import { setArchived } from "@/lib/documents";
import { setDocumentTags, MAX_TAG_LENGTH } from "@/lib/tags";
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
  const hasArchived = body?.archived !== undefined;
  const hasTags = body?.tags !== undefined;
  if (!body || (!hasApprovals && !hasGate && !hasVisibility && !hasArchived && !hasTags)) {
    return NextResponse.json(
      { error: "requiredApprovals, requireBlockerResolution, visibility, archived, or tags required" },
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
  if (hasArchived && typeof body.archived !== "boolean") {
    return NextResponse.json({ error: "archived must be a boolean" }, { status: 400 });
  }
  if (hasTags && (!Array.isArray(body.tags) || body.tags.some((t: unknown) => typeof t !== "string"))) {
    return NextResponse.json({ error: "tags must be an array of strings" }, { status: 400 });
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
  let normalizedTags: string[] | undefined;
  if (hasTags) {
    const result = await setDocumentTags(id, body.tags as string[]);
    if (!result.ok) {
      return NextResponse.json(
        { error: `tags must be non-empty and at most ${MAX_TAG_LENGTH} characters` },
        { status: 400 },
      );
    }
    normalizedTags = result.tags;
  }
  if (hasArchived) await setArchived(id, body.archived as boolean);
  return NextResponse.json({
    ok: true,
    ...(n !== null ? { requiredApprovals: n } : {}),
    ...(gate !== undefined ? { requireBlockerResolution: gate } : {}),
    ...(hasVisibility ? { visibility: body.visibility } : {}),
    ...(hasArchived ? { archived: body.archived as boolean } : {}),
    ...(normalizedTags !== undefined ? { tags: normalizedTags } : {}),
    ...(state !== undefined ? { state } : {}),
  });
}
