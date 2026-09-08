import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { resolveAccess, documentIdForAnnotation } from "@/lib/authz";
import { addComment } from "@/lib/annotations";

const MAX_BODY_CHARS = 20000;

export async function POST(req: Request, { params }: { params: Promise<{ id: string; threadId: string }> }) {
  const authd = await requireApiUser(req);
  if (!authd.ok) return authd.response;
  const { id, threadId } = await params;
  const access = await resolveAccess(authd.user.id, id);
  if (!access?.canManage) return NextResponse.json({ error: "not found" }, { status: 404, headers: authd.headers });
  if (!authd.scopes.includes("plans:write")) return NextResponse.json({ error: "insufficient scope" }, { status: 403, headers: authd.headers });
  const documentId = await documentIdForAnnotation(threadId);
  if (documentId !== id) return NextResponse.json({ error: "not found" }, { status: 404, headers: authd.headers });
  if (access.archived) return NextResponse.json({ error: "archived" }, { status: 409, headers: authd.headers });
  const body = await req.json().catch(() => null);
  const trimmed = typeof body?.body === "string" ? body.body.trim() : "";
  if (!trimmed) return NextResponse.json({ error: "body required" }, { status: 400, headers: authd.headers });
  if (trimmed.length > MAX_BODY_CHARS) {
    return NextResponse.json({ error: `body exceeds ${MAX_BODY_CHARS} characters` }, { status: 413, headers: authd.headers });
  }
  const comment = await addComment(authd.user.id, threadId, trimmed);
  return NextResponse.json({ comment }, { status: 201, headers: authd.headers });
}
