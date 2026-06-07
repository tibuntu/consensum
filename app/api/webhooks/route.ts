import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { createWebhook, listWebhooks } from "@/lib/webhooks";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/enums";

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ webhooks: await listWebhooks(user.id) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.url !== "string") return NextResponse.json({ error: "url required" }, { status: 400 });
  const events = Array.isArray(body.events)
    ? body.events.filter((e: unknown): e is WebhookEvent => typeof e === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(e))
    : [];
  if (events.length === 0) return NextResponse.json({ error: "at least one valid event required" }, { status: 400 });
  const documentId = typeof body.documentId === "string" && body.documentId.trim() ? body.documentId : null;
  try {
    const { id, secret } = await createWebhook(user.id, { url: body.url, events, documentId });
    return NextResponse.json({ id, secret }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "invalid webhook" }, { status: 400 });
  }
}
