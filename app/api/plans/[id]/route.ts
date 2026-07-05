import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { createVersion, ConcurrencyError } from "@/lib/versions";
import { resolveAccess } from "@/lib/authz";
import { maxPlanBytes } from "@/lib/config";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authd = await requireApiUser(req);
  if (!authd.ok) return authd.response;
  const { id } = await params;
  const access = await resolveAccess(authd.user.id, id);
  if (!access?.canManage) return NextResponse.json({ error: "not found" }, { status: 404, headers: authd.headers });
  if (!authd.scopes.includes("plans:write")) return NextResponse.json({ error: "insufficient scope" }, { status: 403, headers: authd.headers });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.markdown !== "string" || typeof body.baseVersionNumber !== "number") {
    return NextResponse.json({ error: "markdown and baseVersionNumber required" }, { status: 400, headers: authd.headers });
  }
  const maxBytes = maxPlanBytes();
  if (Buffer.byteLength(body.markdown, "utf8") > maxBytes) {
    return NextResponse.json({ error: `markdown exceeds ${maxBytes} bytes` }, { status: 413, headers: authd.headers });
  }
  try {
    const result = await createVersion(authd.user.id, id, body.baseVersionNumber, body.markdown);
    return NextResponse.json(result, { headers: authd.headers });
  } catch (e) {
    if (e instanceof ConcurrencyError) return NextResponse.json({ error: "stale version" }, { status: 409, headers: authd.headers });
    throw e;
  }
}
