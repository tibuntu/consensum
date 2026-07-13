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

// Single parse: validates and yields the normalized WHATWG href to store, so
// stored URLs never carry stray whitespace/tabs from raw agent input.
function parseLink(input: LinkInput): { error: LinkErrorCode } | { href: string } {
  if (input.url.length > MAX_URL_CHARS) return { error: "url_too_long" };
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return { error: "invalid_url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { error: "invalid_url" };
  if ((input.label ?? "").trim().length > MAX_LABEL_CHARS) return { error: "label_too_long" };
  if (input.kind != null && !LINK_KINDS.includes(input.kind as LinkKind)) return { error: "invalid_kind" };
  return { href: parsed.href };
}

export async function addLink(actorId: string, documentId: string, input: LinkInput): Promise<AddLinkResult> {
  const parsed = parseLink(input);
  if ("error" in parsed) return parsed;
  const link = await prisma.implementationLink.create({
    data: {
      documentId,
      url: parsed.href,
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
