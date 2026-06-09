import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { isParticipant } from "@/lib/authz";
import { heartbeat, leave } from "@/lib/presence";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isParticipant(user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (body?.leaving === true) {
    leave(id, user.id);
  } else {
    const name = (user.name && user.name.trim()) || user.email || "Someone";
    heartbeat(id, { userId: user.id, name });
  }
  return new Response(null, { status: 204 });
}
