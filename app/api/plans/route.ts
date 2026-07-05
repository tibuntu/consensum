import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { baseUrl, maxPlanBytes, MAX_PLAN_TITLE_CHARS } from "@/lib/config";
import { createDocument, findPlanByIdempotencyKey } from "@/lib/documents";
import { parseRequiredApprovals } from "@/lib/approvals";

export async function POST(req: Request) {
  const authd = await requireApiUser(req);
  if (!authd.ok) return authd.response;
  if (!authd.scopes.includes("plans:write")) return NextResponse.json({ error: "insufficient scope" }, { status: 403, headers: authd.headers });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || typeof body.markdown !== "string") {
    return NextResponse.json({ error: "title and markdown required" }, { status: 400, headers: authd.headers });
  }
  if (body.title.length > MAX_PLAN_TITLE_CHARS) {
    return NextResponse.json({ error: `title exceeds ${MAX_PLAN_TITLE_CHARS} characters` }, { status: 413, headers: authd.headers });
  }
  const maxBytes = maxPlanBytes();
  if (Buffer.byteLength(body.markdown, "utf8") > maxBytes) {
    return NextResponse.json({ error: `markdown exceeds ${maxBytes} bytes` }, { status: 413, headers: authd.headers });
  }
  const agentContext = typeof body.agentContext === "string" ? body.agentContext : undefined;
  let requiredApprovals: number | undefined;
  if (body.requiredApprovals !== undefined) {
    const parsed = parseRequiredApprovals(body.requiredApprovals);
    if (parsed === null) return NextResponse.json({ error: "requiredApprovals must be an integer 1–10" }, { status: 400, headers: authd.headers });
    requiredApprovals = parsed;
  }
  let requireBlockerResolution: boolean | undefined;
  if (body.requireBlockerResolution !== undefined) {
    if (typeof body.requireBlockerResolution !== "boolean") {
      return NextResponse.json({ error: "requireBlockerResolution must be a boolean" }, { status: 400, headers: authd.headers });
    }
    requireBlockerResolution = body.requireBlockerResolution;
  }
  const headerKey = req.headers.get("idempotency-key")?.trim();
  const idempotencyKey = headerKey || (typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "") || undefined;
  const base = baseUrl();
  const url = (planId: string) => `${base}/documents/${planId}`;

  // Idempotent create: a repeated key returns the original plan (200), never a duplicate.
  if (idempotencyKey) {
    const existing = await findPlanByIdempotencyKey(authd.user.id, idempotencyKey);
    if (existing) return NextResponse.json({ id: existing.id, reviewUrl: url(existing.id), idempotent: true }, { status: 200, headers: authd.headers });
  }
  try {
    const id = await createDocument(authd.user.id, body.title, body.markdown, { source: "CLAUDE_CODE", agentContext, requiredApprovals, requireBlockerResolution, idempotencyKey });
    return NextResponse.json({ id, reviewUrl: url(id) }, { status: 201, headers: authd.headers });
  } catch (e) {
    // Lost the create race on the same key — return the winning plan rather than erroring.
    if (idempotencyKey && (e as { code?: string })?.code === "P2002") {
      const existing = await findPlanByIdempotencyKey(authd.user.id, idempotencyKey);
      if (existing) return NextResponse.json({ id: existing.id, reviewUrl: url(existing.id), idempotent: true }, { status: 200, headers: authd.headers });
    }
    throw e;
  }
}
