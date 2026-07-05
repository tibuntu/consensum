import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { resolveAccess } from "@/lib/authz";
import { listVersions } from "@/lib/versions";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const access = await resolveAccess(user.id, id);
  if (!access) return NextResponse.json({ error: "not found" }, { status: 404 });
  const versions = await listVersions(id);
  return NextResponse.json({ versions });
}
