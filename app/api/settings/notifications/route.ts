import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";

export async function PATCH(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const updates: { emailNotifications?: boolean; desktopNotifications?: boolean } = {};
  if (typeof body.emailNotifications === "boolean") updates.emailNotifications = body.emailNotifications;
  if (typeof body.desktopNotifications === "boolean") updates.desktopNotifications = body.desktopNotifications;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "emailNotifications or desktopNotifications (boolean) required" },
      { status: 400 }
    );
  }
  await prisma.user.update({ where: { id: user.id }, data: updates });
  return NextResponse.json({ ok: true, ...updates });
}
