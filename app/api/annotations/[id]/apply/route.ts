import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { resolveAccess, documentIdForAnnotation } from "@/lib/authz";
import { applySuggestion, OrphanedAnchorError } from "@/lib/annotations";
import { ConcurrencyError, ArchivedError } from "@/lib/versions";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const documentId = await documentIdForAnnotation(id);
  if (!documentId) return NextResponse.json({ error: "not found" }, { status: 404 });
  const access = await resolveAccess(user.id, documentId);
  if (!access) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!access.canManage) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.baseVersionNumber !== "number") {
    return NextResponse.json({ error: "baseVersionNumber required" }, { status: 400 });
  }

  try {
    const result = await applySuggestion(user.id, id, body.baseVersionNumber);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ConcurrencyError) return NextResponse.json({ error: "stale version" }, { status: 409 });
    if (e instanceof OrphanedAnchorError) return NextResponse.json({ error: "anchor text changed; cannot apply" }, { status: 422 });
    if (e instanceof ArchivedError) return NextResponse.json({ error: "document is archived" }, { status: 409 });
    throw e;
  }
}
