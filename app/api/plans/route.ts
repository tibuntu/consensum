import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { baseUrl } from "@/lib/config";
import { createDocument } from "@/lib/documents";

export async function POST(req: Request) {
  const authd = await requireApiUser(req);
  if (!authd) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!authd.scopes.includes("plans:write")) return NextResponse.json({ error: "insufficient scope" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || typeof body.markdown !== "string") {
    return NextResponse.json({ error: "title and markdown required" }, { status: 400 });
  }
  const agentContext = typeof body.agentContext === "string" ? body.agentContext : undefined;
  const id = await createDocument(authd.user.id, body.title, body.markdown, { source: "CLAUDE_CODE", agentContext });
  const base = baseUrl();
  return NextResponse.json({ id, reviewUrl: `${base}/app/documents/${id}` }, { status: 201 });
}
