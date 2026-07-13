import { prisma } from "@/lib/db";

export const MAX_TAG_LENGTH = 50;

/** Normalize a raw tag name: NFC-normalize, trim, collapse inner whitespace,
 *  lowercase. Lowercasing gives case-insensitive uniqueness without
 *  dialect-specific collation; NFC keeps visually-identical names (composed vs
 *  decomposed accents) from becoming distinct tags. Returns null for empty or
 *  over-long names. */
export function normalizeTagName(raw: string): string | null {
  const name = raw.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  if (!name || name.length > MAX_TAG_LENGTH) return null;
  return name;
}

/** Replace-set a document's tags (callers send the full desired array).
 *  The route owns the canManage gate — this function does not authorize.
 *  Tag rows are global and upserted by normalized name; orphaned Tag rows
 *  are deliberately left in place (suggestions are global anyway). */
export async function setDocumentTags(
  documentId: string,
  names: string[],
): Promise<{ ok: true; tags: string[] } | { ok: false; error: "invalid_tag" }> {
  const normalized: string[] = [];
  for (const raw of names) {
    const name = normalizeTagName(raw);
    if (name === null) return { ok: false, error: "invalid_tag" };
    if (!normalized.includes(name)) normalized.push(name);
  }
  const tags = await Promise.all(
    normalized.map((name) => prisma.tag.upsert({ where: { name }, create: { name }, update: {} })),
  );
  await prisma.$transaction([
    prisma.documentTag.deleteMany({ where: { documentId, tagId: { notIn: tags.map((t) => t.id) } } }),
    ...tags.map((t) =>
      prisma.documentTag.upsert({
        where: { documentId_tagId: { documentId, tagId: t.id } },
        create: { documentId, tagId: t.id },
        update: {},
      }),
    ),
  ]);
  return { ok: true, tags: normalized };
}

/** Every tag name on the instance, alphabetically — autocomplete suggestions
 *  are global by design decision (tag names are instance-public metadata). */
export async function listAllTags(): Promise<string[]> {
  const tags = await prisma.tag.findMany({ orderBy: { name: "asc" }, select: { name: true } });
  return tags.map((t) => t.name);
}
