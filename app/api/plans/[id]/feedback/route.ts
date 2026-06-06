import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { getPlanFeedback } from "@/lib/feedback";
import { isOwner } from "@/lib/authz";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authd = await requireApiUser(req);
  if (!authd) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isOwner(authd.user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!authd.scopes.includes("feedback:read")) return NextResponse.json({ error: "insufficient scope" }, { status: 403 });
  const feedback = await getPlanFeedback(id);
  if (!feedback) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(feedback);
}
