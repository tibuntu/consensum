import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { isParticipant } from "@/lib/authz";
import { heartbeat, leave, type PresenceSelection } from "@/lib/presence";

/** null = no selection; "invalid" = malformed payload (reject with 400). */
function parseSelection(raw: unknown): PresenceSelection | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "invalid";
  const { start, end, versionNumber } = raw as Record<string, unknown>;
  if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(versionNumber)) return "invalid";
  if ((start as number) < 0 || (start as number) >= (end as number) || (versionNumber as number) < 1) return "invalid";
  return { start, end, versionNumber } as PresenceSelection;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isParticipant(user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (body?.leaving === true) {
    leave(id, user.id);
    return new Response(null, { status: 204 });
  }
  const selection = parseSelection(body?.selection);
  if (selection === "invalid") return NextResponse.json({ error: "invalid selection" }, { status: 400 });
  const name = (user.name && user.name.trim()) || user.email || "Someone";
  heartbeat(id, { userId: user.id, name }, selection);
  return new Response(null, { status: 204 });
}
