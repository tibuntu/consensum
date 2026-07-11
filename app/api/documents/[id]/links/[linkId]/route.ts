import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { resolveAccess } from "@/lib/authz";
import { removeLink } from "@/lib/links";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, linkId } = await params;
  const access = await resolveAccess(user.id, id);
  if (!access) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!access.canManage) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const res = await removeLink(id, linkId);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: 404 });
  return NextResponse.json({ ok: true });
}
