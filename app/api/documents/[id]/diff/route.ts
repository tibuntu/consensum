import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { resolveAccess } from "@/lib/authz";
import { getVersionMarkdown } from "@/lib/versions";
import { diffMarkdown } from "@/lib/diff";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const access = await resolveAccess(user.id, id);
  if (!access) return NextResponse.json({ error: "not found" }, { status: 404 });

  const sp = new URL(req.url).searchParams;
  const from = Number(sp.get("from"));
  const to = Number(sp.get("to"));
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1) {
    return NextResponse.json({ error: "invalid version params" }, { status: 400 });
  }
  const [oldMd, newMd] = await Promise.all([getVersionMarkdown(id, from), getVersionMarkdown(id, to)]);
  if (oldMd === null || newMd === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ rows: diffMarkdown(oldMd, newMd) });
}
