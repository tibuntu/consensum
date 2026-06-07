import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { createAnnotation } from "@/lib/annotations";
import { ANNOTATION_KINDS, type AnnotationKind, SEVERITIES, type Severity } from "@/lib/enums";
import { isParticipant } from "@/lib/authz";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isParticipant(user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.body !== "string" ||
    typeof body.startOffset !== "number" ||
    typeof body.endOffset !== "number" ||
    !body.quote ||
    typeof body.quote.exact !== "string" ||
    typeof body.quote.prefix !== "string" ||
    typeof body.quote.suffix !== "string"
  ) {
    return NextResponse.json({ error: "quote, startOffset, endOffset and body required" }, { status: 400 });
  }
  const kind: AnnotationKind | undefined =
    typeof body.kind === "string" && ANNOTATION_KINDS.includes(body.kind as AnnotationKind)
      ? (body.kind as AnnotationKind)
      : undefined;
  let severity: Severity | undefined;
  if (body.severity != null) {
    if (typeof body.severity !== "string" || !SEVERITIES.includes(body.severity as Severity)) {
      return NextResponse.json({ error: `severity must be one of ${SEVERITIES.join(", ")}` }, { status: 400 });
    }
    severity = body.severity as Severity;
  }
  const category: string | undefined = typeof body.category === "string" && body.category.trim() !== "" ? body.category.trim() : undefined;
  const annotation = await createAnnotation(
    user.id,
    id,
    { quote: body.quote, startOffset: body.startOffset, endOffset: body.endOffset, kind, severity, category },
    body.body
  );
  return NextResponse.json({ annotation }, { status: 201 });
}
