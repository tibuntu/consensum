import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { resolveAccess } from "@/lib/authz";
import { maxPlanBytes } from "@/lib/config";
import { prisma } from "@/lib/db";

// Artifact names are written to the receiver's disk by /consensum-pull-plan,
// so they are a trust boundary: no separators, no leading dot, bounded length.
// Content is opaque — never parsed (tasks.json format varies across clients).
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MAX_ARTIFACTS_PER_PLAN = 10;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authd = await requireApiUser(req);
  if (!authd.ok) return authd.response;
  const { id } = await params;
  const access = await resolveAccess(authd.user.id, id);
  if (!access?.canManage) return NextResponse.json({ error: "not found" }, { status: 404, headers: authd.headers });
  if (!authd.scopes.includes("plans:write")) return NextResponse.json({ error: "insufficient scope" }, { status: 403, headers: authd.headers });
  if (access.archived) return NextResponse.json({ error: "document is archived" }, { status: 409, headers: authd.headers });

  const body = await req.json().catch(() => null);
  const items: unknown = body?.artifacts;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "artifacts array required" }, { status: 400, headers: authd.headers });
  }
  const maxBytes = maxPlanBytes();
  const seen = new Set<string>();
  for (const a of items as Array<{ name?: unknown; content?: unknown; gitSha?: unknown }>) {
    if (!a || typeof a.name !== "string" || !NAME_RE.test(a.name)) {
      return NextResponse.json({ error: "invalid artifact name" }, { status: 400, headers: authd.headers });
    }
    if (seen.has(a.name)) {
      return NextResponse.json({ error: `duplicate artifact name: ${a.name}` }, { status: 400, headers: authd.headers });
    }
    seen.add(a.name);
    if (typeof a.content !== "string") {
      return NextResponse.json({ error: "content must be a string" }, { status: 400, headers: authd.headers });
    }
    if (Buffer.byteLength(a.content, "utf8") > maxBytes) {
      return NextResponse.json({ error: `content exceeds ${maxBytes} bytes` }, { status: 413, headers: authd.headers });
    }
    if (a.gitSha !== undefined && typeof a.gitSha !== "string") {
      return NextResponse.json({ error: "gitSha must be a string" }, { status: 400, headers: authd.headers });
    }
  }

  // ponytail: count check outside the write transaction — only the owner's
  // agent pushes, so a concurrent-push overshoot isn't worth a serialized guard.
  const existing = await prisma.planArtifact.findMany({ where: { documentId: id }, select: { name: true } });
  const resulting = new Set([...existing.map((e) => e.name), ...seen]);
  if (resulting.size > MAX_ARTIFACTS_PER_PLAN) {
    return NextResponse.json({ error: `artifact count exceeds ${MAX_ARTIFACTS_PER_PLAN}` }, { status: 413, headers: authd.headers });
  }

  const typed = items as Array<{ name: string; content: string; gitSha?: string }>;
  const results = await prisma.$transaction(
    typed.map((a) =>
      prisma.planArtifact.upsert({
        where: { documentId_name: { documentId: id, name: a.name } },
        create: { documentId: id, name: a.name, content: a.content, gitSha: a.gitSha ?? null, pushedById: authd.user.id },
        update: { content: a.content, gitSha: a.gitSha ?? null, pushedById: authd.user.id },
      }),
    ),
  );
  return NextResponse.json(
    { artifacts: results.map((r) => ({ name: r.name, pushedAt: r.pushedAt })) },
    { headers: authd.headers },
  );
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authd = await requireApiUser(req);
  if (!authd.ok) return authd.response;
  const { id } = await params;
  const access = await resolveAccess(authd.user.id, id);
  if (!access?.canView) return NextResponse.json({ error: "not found" }, { status: 404, headers: authd.headers });
  if (!authd.scopes.includes("feedback:read")) return NextResponse.json({ error: "insufficient scope" }, { status: 403, headers: authd.headers });
  const artifacts = await prisma.planArtifact.findMany({
    where: { documentId: id },
    orderBy: { name: "asc" },
    select: { name: true, content: true, gitSha: true, pushedAt: true },
  });
  return NextResponse.json({ artifacts }, { headers: authd.headers });
}
