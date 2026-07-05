import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { getPlanFeedback } from "@/lib/feedback";
import { resolveAccess } from "@/lib/authz";

function csv(v: string | null): string[] | undefined {
  if (!v) return undefined;
  const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authd = await requireApiUser(req);
  if (!authd.ok) return authd.response;
  const { id } = await params;
  const access = await resolveAccess(authd.user.id, id);
  if (!access?.canManage) return NextResponse.json({ error: "not found" }, { status: 404, headers: authd.headers });
  if (!authd.scopes.includes("feedback:read")) return NextResponse.json({ error: "insufficient scope" }, { status: 403, headers: authd.headers });
  const url = new URL(req.url);
  const include = csv(url.searchParams.get("include"));
  const exclude = csv(url.searchParams.get("exclude"));
  const feedback = await getPlanFeedback(id, { include, exclude });
  if (!feedback) return NextResponse.json({ error: "not found" }, { status: 404, headers: authd.headers });
  return NextResponse.json(feedback, { headers: authd.headers });
}
