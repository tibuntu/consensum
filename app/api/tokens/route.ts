import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { generateToken, listTokens } from "@/lib/tokens";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ tokens: await listTokens(user.id) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.label !== "string" || !body.label.trim()) {
    return NextResponse.json({ error: "label required" }, { status: 400 });
  }
  const allowedScopes = ["plans:write", "feedback:read"];
  const expiresInDays = typeof body.expiresInDays === "number" && body.expiresInDays > 0 ? body.expiresInDays : null;
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null;
  // Omitted scopes → default to both. An explicit array (even empty) is honored
  // as-is after allow-list filtering, so callers can mint a locked-down token;
  // a bogus/empty array never silently grants full scope.
  const scopes = !Array.isArray(body.scopes)
    ? "plans:write,feedback:read"
    : body.scopes.filter((s: unknown): s is string => typeof s === "string" && allowedScopes.includes(s)).join(",");
  const { id, token } = await generateToken(user.id, body.label.trim(), { expiresAt, scopes });
  return NextResponse.json({ id, token }, { status: 201 });
}
