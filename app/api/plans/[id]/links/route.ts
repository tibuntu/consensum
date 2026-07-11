import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { resolveAccess } from "@/lib/authz";
import { addLink } from "@/lib/links";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authd = await requireApiUser(req);
  if (!authd.ok) return authd.response;
  const { id } = await params;
  const access = await resolveAccess(authd.user.id, id);
  if (!access?.canManage) return NextResponse.json({ error: "not found" }, { status: 404, headers: authd.headers });
  if (!authd.scopes.includes("plans:write")) return NextResponse.json({ error: "insufficient scope" }, { status: 403, headers: authd.headers });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.url !== "string") {
    return NextResponse.json({ error: "url required" }, { status: 400, headers: authd.headers });
  }
  const res = await addLink(authd.user.id, id, {
    url: body.url,
    label: typeof body.label === "string" ? body.label : null,
    kind: typeof body.kind === "string" ? body.kind : null,
  });
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: 400, headers: authd.headers });
  return NextResponse.json({ link: res.link }, { status: 201, headers: authd.headers });
}
