import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { baseUrl, maxPlanBytes, MAX_PLAN_TITLE_CHARS } from "@/lib/config";
import { createDocument, findPlanByIdempotencyKey } from "@/lib/documents";
import { parseRequiredApprovals } from "@/lib/approvals";
import { shareWith } from "@/lib/sharing";
import { normalizeTagName, setDocumentTags, MAX_TAG_LENGTH } from "@/lib/tags";

interface ReviewerInput {
  email: string;
  required: boolean;
}

/** One reviewers[] item: an email string, or {email, required?}. Anything else is invalid. */
function parseReviewerItem(item: unknown): ReviewerInput | null {
  if (typeof item === "string") return { email: item, required: false };
  if (item && typeof item === "object") {
    const obj = item as Record<string, unknown>;
    if (typeof obj.email === "string" && (obj.required === undefined || typeof obj.required === "boolean")) {
      return { email: obj.email, required: obj.required ?? false };
    }
  }
  return null;
}

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
  let reviewers: ReviewerInput[] | undefined;
  if (body.reviewers !== undefined) {
    if (!Array.isArray(body.reviewers) || body.reviewers.length > 20) {
      return NextResponse.json(
        { error: "reviewers must be an array of emails or {email, required} objects (max 20)" },
        { status: 400, headers: authd.headers },
      );
    }
    reviewers = [];
    for (const item of body.reviewers) {
      const parsed = parseReviewerItem(item);
      if (!parsed) {
        return NextResponse.json(
          { error: "reviewers must be an array of emails or {email, required} objects (max 20)" },
          { status: 400, headers: authd.headers },
        );
      }
      reviewers.push(parsed);
    }
  }
  let tags: string[] | undefined;
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.length > 20 || body.tags.some((t: unknown) => typeof t !== "string")) {
      return NextResponse.json({ error: "tags must be an array of strings (max 20)" }, { status: 400, headers: authd.headers });
    }
    for (const t of body.tags as string[]) {
      if (normalizeTagName(t) === null) {
        return NextResponse.json(
          { error: `tags must be non-empty and at most ${MAX_TAG_LENGTH} characters` },
          { status: 400, headers: authd.headers },
        );
      }
    }
    tags = body.tags as string[];
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

    let reviewersOut: { email: string; status: string }[] | undefined;
    if (reviewers) {
      reviewersOut = [];
      const seen = new Set<string>();
      for (const r of reviewers) {
        const email = r.email.trim().toLowerCase();
        if (seen.has(email)) continue;
        seen.add(email);
        const result = await shareWith(authd.user.id, id, email, "REVIEWER", r.required);
        reviewersOut.push({ email, status: "ok" in result ? "added" : result.error });
      }
    }
    let tagsOut: string[] | undefined;
    if (tags) {
      const result = await setDocumentTags(id, tags);
      if (result.ok) tagsOut = result.tags;
    }

    return NextResponse.json(
      {
        id,
        reviewUrl: url(id),
        ...(reviewersOut !== undefined ? { reviewers: reviewersOut } : {}),
        ...(tagsOut !== undefined ? { tags: tagsOut } : {}),
      },
      { status: 201, headers: authd.headers },
    );
  } catch (e) {
    // Lost the create race on the same key — return the winning plan rather than erroring.
    if (idempotencyKey && (e as { code?: string })?.code === "P2002") {
      const existing = await findPlanByIdempotencyKey(authd.user.id, idempotencyKey);
      if (existing) return NextResponse.json({ id: existing.id, reviewUrl: url(existing.id), idempotent: true }, { status: 200, headers: authd.headers });
    }
    throw e;
  }
}
