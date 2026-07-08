import { NextResponse } from "next/server";
import { requireAdmin, setRole, setDisabled, type AdminActionResult } from "@/lib/admin";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { id } = await params;
  const body = await req.json().catch(() => null);

  let result: AdminActionResult;
  if (body?.role === "admin" || body?.role === "member") {
    result = await setRole(admin.id, id, body.role);
  } else if (typeof body?.disabled === "boolean") {
    result = await setDisabled(admin.id, id, body.disabled);
  } else {
    return NextResponse.json({ error: "role or disabled required" }, { status: 400 });
  }
  if ("error" in result) return NextResponse.json(result, { status: 409 });
  return NextResponse.json(result);
}
