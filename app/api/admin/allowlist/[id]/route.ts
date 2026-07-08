import { NextResponse } from "next/server";
import { requireAdmin, removeAllowlistEntry } from "@/lib/admin";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { id } = await params;
  await removeAllowlistEntry(id);
  return NextResponse.json({ ok: true });
}
