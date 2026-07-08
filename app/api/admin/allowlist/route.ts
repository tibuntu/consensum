import { NextResponse } from "next/server";
import { requireAdmin, listAllowlist, addAllowlistEntry } from "@/lib/admin";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(await listAllowlist());
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (typeof body?.value !== "string") return NextResponse.json({ error: "value required" }, { status: 400 });
  const res = await addAllowlistEntry(admin.id, body.value);
  if ("error" in res) return NextResponse.json(res, { status: 400 });
  return NextResponse.json(res, { status: 201 });
}
