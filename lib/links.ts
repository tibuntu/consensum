import { prisma } from "@/lib/db";
import { notifyParticipants } from "@/lib/notifications";
import { LINK_KINDS, type LinkKind } from "@/lib/enums";
import type { ImplementationLink } from "@/generated/prisma/client";

const MAX_URL_CHARS = 2048;
const MAX_LABEL_CHARS = 200;

export type LinkInput = { url: string; label?: string | null; kind?: string | null };
export type LinkErrorCode = "invalid_url" | "url_too_long" | "label_too_long" | "invalid_kind";
// Explicit return types (rather than relying on inference) so `"link" in res`
// narrows cleanly for callers instead of leaving `res.link` typed as possibly
// undefined.
export type AddLinkResult = { link: ImplementationLink } | { error: LinkErrorCode };
export type RemoveLinkResult = { ok: true } | { error: "not_found" };

function validate(input: LinkInput): LinkErrorCode | null {
  if (input.url.length > MAX_URL_CHARS) return "url_too_long";
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return "invalid_url";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "invalid_url";
  if ((input.label ?? "").length > MAX_LABEL_CHARS) return "label_too_long";
  if (input.kind != null && !LINK_KINDS.includes(input.kind as LinkKind)) return "invalid_kind";
  return null;
}

export async function addLink(actorId: string, documentId: string, input: LinkInput): Promise<AddLinkResult> {
  const error = validate(input);
  if (error) return { error };
  const link = await prisma.implementationLink.create({
    data: {
      documentId,
      url: input.url,
      label: input.label?.trim() || null,
      kind: (input.kind as LinkKind | null) ?? "other",
      createdById: actorId,
    },
  });
  await notifyParticipants(documentId, actorId, "implementation").catch(() => {});
  return { link };
}

export async function listLinks(documentId: string) {
  return prisma.implementationLink.findMany({ where: { documentId }, orderBy: { createdAt: "asc" } });
}

/** Scoped by documentId so a linkId from another document can't be deleted
 *  through this document's route. */
export async function removeLink(documentId: string, linkId: string): Promise<RemoveLinkResult> {
  const { count } = await prisma.implementationLink.deleteMany({ where: { id: linkId, documentId } });
  return count > 0 ? { ok: true } : { error: "not_found" };
}
