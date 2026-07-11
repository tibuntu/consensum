import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { resolveAccess } from "@/lib/authz";
import { addLink, listLinks } from "@/lib/links";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const access = await resolveAccess(user.id, id);
  if (!access) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ links: await listLinks(id) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const access = await resolveAccess(user.id, id);
  if (!access) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!access.canManage) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.url !== "string") return NextResponse.json({ error: "url required" }, { status: 400 });
  const res = await addLink(user.id, id, {
    url: body.url,
    label: typeof body.label === "string" ? body.label : null,
    kind: typeof body.kind === "string" ? body.kind : null,
  });
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ link: res.link }, { status: 201 });
}
