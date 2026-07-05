import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { resolveAccess } from "@/lib/authz";
import { setRole, removeParticipant } from "@/lib/sharing";
import { DOCUMENT_ROLES, type DocumentRole } from "@/lib/enums";

type ManageGuard = { error: NextResponse } | { ok: true };

// Explicit return type matters here: without it, TS's inferred union return
// type for multiple object-literal returns adds every other branch's keys
// back as optional (e.g. `{ error: ...; ok?: undefined }`), which defeats
// `"error" in guard` narrowing at the call sites below and would let a
// `{ ok: true }` guard's `.error` be read as `NextResponse | undefined`.
async function requireManage(userId: string, id: string): Promise<ManageGuard> {
  const access = await resolveAccess(userId, id);
  if (!access) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  if (!access.canManage) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { ok: true };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; userId: string }> }): Promise<NextResponse> {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, userId } = await params;
  const guard = await requireManage(user.id, id);
  if ("error" in guard) return guard.error;
  const body = await req.json().catch(() => null);
  const role = body?.role as DocumentRole;
  if (!DOCUMENT_ROLES.includes(role)) return NextResponse.json({ error: "valid role required" }, { status: 400 });
  const res = await setRole(id, userId, role);
  if ("error" in res) {
    const status = res.error === "cannot_change_owner" ? 400 : 404;
    return NextResponse.json({ error: res.error }, { status });
  }
  return NextResponse.json(res);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; userId: string }> }): Promise<NextResponse> {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, userId } = await params;
  const guard = await requireManage(user.id, id);
  if ("error" in guard) return guard.error;
  const res = await removeParticipant(user.id, id, userId);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json(res);
}
