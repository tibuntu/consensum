import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { listAllTags } from "@/lib/tags";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ tags: await listAllTags() });
}
