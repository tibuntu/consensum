import { notFound, redirect } from "next/navigation";
import { getDocumentDetail } from "@/lib/documents";
import { getSession } from "@/lib/session";
import { resolveAccess } from "@/lib/authz";
import { isEditUiEnabled } from "@/lib/config";
import { approvalCount } from "@/lib/approvals";
import DocumentView, { type ClientDocument } from "@/components/DocumentView";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const access = await resolveAccess(session.user.id, id);
  if (!access) notFound();
  const doc = await getDocumentDetail(id);
  if (!doc) notFound();

  // The caller's own decisive verdict, for the stale-review banner. APPROVE is
  // dismissed on every push, so in practice this surfaces stale REQUEST_CHANGES.
  const myReview = doc.reviews.find(
    (r) => !r.dismissed && r.reviewerId === session.user.id && (r.verdict === "APPROVE" || r.verdict === "REQUEST_CHANGES"),
  );

  const serializable: ClientDocument = {
    id: doc.id,
    title: doc.title,
    state: doc.state,
    versionNumber: doc.currentVersion?.versionNumber ?? 1,
    markdown: doc.currentVersion?.markdown ?? "",
    requiredApprovals: doc.requiredApprovals,
    requireBlockerResolution: doc.requireBlockerResolution,
    approvals: approvalCount(doc.reviews),
    reviews: doc.reviews
      .filter((r) => !r.dismissed)
      .map((r) => ({
        reviewer: r.reviewer?.name?.trim() || r.reviewer?.email || "Someone",
        verdict: r.verdict,
        onVersionNumber: r.onVersion?.versionNumber ?? null,
      })),
    myReviewedVersion: myReview?.onVersion?.versionNumber ?? null,
    annotations: doc.annotations.map((a) => ({
      id: a.id,
      scope: a.scope,
      anchorExact: a.anchorExact,
      anchorPrefix: a.anchorPrefix,
      anchorSuffix: a.anchorSuffix,
      startOffset: a.startOffset,
      endOffset: a.endOffset,
      threadStatus: a.threadStatus,
      status: a.status,
      kind: a.kind,
      suggestedText: a.suggestedText,
      appliedInVersionNumber: a.appliedInVersion?.versionNumber ?? null,
      comments: a.comments.map((c) => ({ id: c.id, body: c.body, author: c.author })),
    })),
    links: doc.implementationLinks.map((l) => ({ id: l.id, url: l.url, label: l.label, kind: l.kind })),
  };

  const isOwner = doc.ownerId === session.user.id;
  const editEnabled = isEditUiEnabled();
  const currentUserName = session.user.name?.trim() || session.user.email || "You";

  return (
    <DocumentView
      doc={serializable}
      isOwner={isOwner}
      editEnabled={editEnabled}
      currentUserId={session.user.id}
      currentUserName={currentUserName}
      canReview={access.canReview}
      canManage={access.canManage}
      visibility={access.visibility}
      archived={access.archived}
      initialTags={doc.tags.map((t) => t.tag.name)}
    />
  );
}
