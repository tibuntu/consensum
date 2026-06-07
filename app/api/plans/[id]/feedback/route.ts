import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { getPlanFeedback } from "@/lib/feedback";
import { isOwner } from "@/lib/authz";

function csv(v: string | null): string[] | undefined {
  if (!v) return undefined;
  const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authd = await requireApiUser(req);
  if (!authd) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isOwner(authd.user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!authd.scopes.includes("feedback:read")) return NextResponse.json({ error: "insufficient scope" }, { status: 403 });
  const url = new URL(req.url);
  const include = csv(url.searchParams.get("include"));
  const exclude = csv(url.searchParams.get("exclude"));
  const feedback = await getPlanFeedback(id, { include, exclude });
  if (!feedback) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(feedback);
}
