import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { resolveAccess } from "@/lib/authz";
import { listParticipants, shareWith } from "@/lib/sharing";
import { DOCUMENT_ROLES, type DocumentRole } from "@/lib/enums";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const access = await resolveAccess(user.id, id);
  if (!access) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!access.canManage) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ participants: await listParticipants(id) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const access = await resolveAccess(user.id, id);
  if (!access) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!access.canManage) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : null;
  const role = body?.role as DocumentRole;
  if (!email || !DOCUMENT_ROLES.includes(role)) {
    return NextResponse.json({ error: "email and valid role required" }, { status: 400 });
  }
  const res = await shareWith(user.id, id, email, role);
  if ("error" in res) {
    const status = res.error === "no_account" ? 409 : 400;
    return NextResponse.json({ error: res.error }, { status });
  }
  return NextResponse.json(res);
}
