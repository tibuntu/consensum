import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { isParticipant, isOwner, documentIdForAnnotation } from "@/lib/authz";
import { applySuggestion, OrphanedAnchorError } from "@/lib/annotations";
import { ConcurrencyError } from "@/lib/versions";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const documentId = await documentIdForAnnotation(id);
  if (!documentId) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await isParticipant(user.id, documentId))) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await isOwner(user.id, documentId))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

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
    throw e;
  }
}
