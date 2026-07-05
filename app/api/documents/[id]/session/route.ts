import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { resolveAccess } from "@/lib/authz";
import { startSession, joinSession, leaveSession, endSession } from "@/lib/review-session";
import { SESSION_ACTIONS, type SessionAction } from "@/lib/enums";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const access = await resolveAccess(user.id, id);
  if (!access) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const action = body?.action as unknown;
  if (typeof action !== "string" || !SESSION_ACTIONS.includes(action as SessionAction)) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }
  const name = (user.name && user.name.trim()) || user.email || "Someone";

  switch (action as SessionAction) {
    case "start": {
      const session = startSession(id, { userId: user.id, name });
      if (!session) return NextResponse.json({ error: "session already active" }, { status: 409 });
      return NextResponse.json({ session }, { status: 200 });
    }
    case "join": {
      const session = joinSession(id, { userId: user.id, name });
      if (!session) return NextResponse.json({ error: "no active session" }, { status: 409 });
      return NextResponse.json({ session }, { status: 200 });
    }
    case "leave": {
      leaveSession(id, user.id);
      return new Response(null, { status: 204 });
    }
    case "end": {
      if (!endSession(id, user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
      return new Response(null, { status: 204 });
    }
  }
}
