import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { updateWebhook, deleteWebhook } from "@/lib/webhooks";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/enums";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const patch: { active?: boolean; events?: WebhookEvent[] } = {};
  if (typeof body.active === "boolean") patch.active = body.active;
  if (Array.isArray(body.events)) {
    patch.events = body.events.filter((e: unknown): e is WebhookEvent => typeof e === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(e));
  }
  await updateWebhook(user.id, id, patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await deleteWebhook(user.id, id);
  return NextResponse.json({ ok: true });
}
