import { NextResponse } from "next/server";
import { requireAdmin, listUsers } from "@/lib/admin";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ users: await listUsers() });
}
