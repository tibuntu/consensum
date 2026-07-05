import { test, expect, type Page } from "@playwright/test";

const NOT_FOUND_TEXT = "This page could not be found.";

async function register(page: Page, name: string): Promise<string> {
  const email = `ac-${name.toLowerCase()}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill(name);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);
  return email;
}

async function createDoc(page: Page, title: string, markdown: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("title").fill(title);
  await page.getByLabel("markdown").fill(markdown);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/documents\//);
  return page.url();
}

function shareDialog(page: Page) {
  return page.getByRole("dialog", { name: "Share document" });
}

/** Owner (on the document page) shares with `email` at `role` via the Share dialog. */
async function shareWith(owner: Page, email: string, role: "REVIEWER" | "VIEWER") {
  await owner.getByTestId("share-document").click();
  const dialog = shareDialog(owner);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("email").fill(email);
  await dialog.getByLabel("role").selectOption(role);
  const shared = owner.waitForResponse((r) => r.url().endsWith("/participants") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Share" }).click();
  expect((await shared).ok()).toBeTruthy();
  await dialog.getByRole("button", { name: "Close" }).click();
}

/** Owner changes an existing participant's role via the Share dialog's per-row select. */
async function changeParticipantRole(owner: Page, email: string, role: "REVIEWER" | "VIEWER") {
  await owner.getByTestId("share-document").click();
  const dialog = shareDialog(owner);
  await expect(dialog).toBeVisible();
  const changed = owner.waitForResponse((r) => r.url().includes("/participants/") && r.request().method() === "PATCH");
  await dialog.getByLabel(`role for ${email}`).selectOption(role);
  expect((await changed).ok()).toBeTruthy();
  await dialog.getByRole("button", { name: "Close" }).click();
}

/** Owner removes a participant via the Share dialog's Remove button (behind a window.confirm). */
async function removeParticipant(owner: Page, email: string) {
  await owner.getByTestId("share-document").click();
  const dialog = shareDialog(owner);
  await expect(dialog).toBeVisible();
  owner.once("dialog", (d) => d.accept());
  const removed = owner.waitForResponse((r) => r.url().includes("/participants/") && r.request().method() === "DELETE");
  // The "has" locator must not itself be dialog-scoped (that bakes in a
  // "role=dialog >> ..." prefix which then never matches as a *descendant* of
  // the candidate <li> and hangs forever) — an unscoped page locator composes
  // correctly as "find an li that has this element somewhere inside it".
  const row = dialog.locator("li").filter({ has: owner.getByLabel(`role for ${email}`) });
  await row.getByRole("button", { name: "Remove" }).click();
  expect((await removed).ok()).toBeTruthy();
  await dialog.getByRole("button", { name: "Close" }).click();
}

test("owner shares a PRIVATE document as reviewer: the reviewer sees it in their list and can open it", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await register(owner, "Owner");

  const reviewerCtx = await browser.newContext();
  const reviewer = await reviewerCtx.newPage();
  const reviewerEmail = await register(reviewer, "Reviewer");

  const url = await createDoc(owner, "Confidential Rollout Plan", "The rollout covers three regions in phase one.");

  // Before any sharing: a signed-in user (even one who will later be shared with)
  // has no access to a PRIVATE document and does not appear in its list.
  await reviewer.goto("/");
  await expect(reviewer.getByText("Confidential Rollout Plan")).toHaveCount(0);

  await shareWith(owner, reviewerEmail, "REVIEWER");

  // Now it appears in the reviewer's documents list … The reviewer is a
  // non-required REVIEWER on an OPEN doc, so the same title also shows under
  // the home page's "Open reviews" queue section — `.first()` picks either
  // match, both link to the same document.
  await reviewer.goto("/");
  const docLink = reviewer.getByRole("link").filter({ hasText: "Confidential Rollout Plan" }).first();
  await expect(docLink).toBeVisible();

  // … and the reviewer can open it.
  await docLink.click();
  await expect(reviewer).toHaveURL(url);
  await expect(reviewer.getByTestId("doc-body")).toContainText("three regions");

  await ownerCtx.close();
  await reviewerCtx.close();
});

test("owner demotes a reviewer to viewer: verdict buttons disappear and the reviews API returns 403", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await register(owner, "Owner");

  const viewerCtx = await browser.newContext();
  const viewer = await viewerCtx.newPage();
  const viewerEmail = await register(viewer, "Viewer");

  const url = await createDoc(owner, "Viewer Downgrade Plan", "Please review this rollout carefully.");
  const id = url.split("/documents/")[1];

  // Start as REVIEWER (so the downgrade is a real role change, not just an invite-as-viewer).
  await shareWith(owner, viewerEmail, "REVIEWER");
  await changeParticipantRole(owner, viewerEmail, "VIEWER");

  await viewer.goto(url);
  await expect(viewer.getByTestId("doc-body")).toContainText("rollout carefully");
  await expect(viewer.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Request changes" })).toHaveCount(0);

  const forbidden = await viewer.request.post(`/api/documents/${id}/reviews`, { data: { verdict: "APPROVE" } });
  expect(forbidden.status()).toBe(403);

  await ownerCtx.close();
  await viewerCtx.close();
});

test("a never-shared signed-in user opening a PRIVATE document URL gets not-found (no auto-join)", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await register(owner, "Owner");

  const strangerCtx = await browser.newContext();
  const stranger = await strangerCtx.newPage();
  await register(stranger, "Stranger");

  const url = await createDoc(owner, "Private Strategy Memo", "Not for outside eyes.");
  const id = url.split("/documents/")[1];

  // The route has a loading.tsx (a streaming boundary), so the initial shell
  // ships as HTTP 200 before the nested notFound() resolves — the *content*
  // that eventually streams in is still the not-found page, which is what
  // actually matters here (no PRIVATE content or auto-join UI ever renders).
  await stranger.goto(url);
  await expect(stranger.getByText(NOT_FOUND_TEXT)).toBeVisible();

  // No side-effect participant row: opening the URL must not auto-join the stranger.
  const participants = await owner.request.get(`/api/documents/${id}/participants`);
  expect(participants.status()).toBe(200);
  const { participants: rows } = await participants.json();
  expect(rows).toHaveLength(1);
  expect(rows[0].isOwner).toBe(true);

  await ownerCtx.close();
  await strangerCtx.close();
});

test("removing an approving reviewer drops the approval and revokes their access", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await register(owner, "Owner");

  const reviewerCtx = await browser.newContext();
  const reviewer = await reviewerCtx.newPage();
  const reviewerEmail = await register(reviewer, "Reviewer");

  const url = await createDoc(owner, "Removable Reviewer Plan", "Approve if this looks right to you.");

  await shareWith(owner, reviewerEmail, "REVIEWER");

  await reviewer.goto(url);
  // The Approve button is server-rendered; wait for the client component to hydrate
  // (it POSTs presence on mount) before clicking, or the click is a no-op against an
  // un-wired handler and the review never registers.
  await reviewer.waitForResponse((r) => r.url().includes("/presence") && r.request().method() === "POST");
  const approved = reviewer.waitForResponse((r) => r.url().includes("/reviews") && r.request().method() === "POST");
  await reviewer.getByRole("button", { name: "Approve" }).click();
  expect((await approved).ok()).toBeTruthy();

  // requiredApprovals defaults to 1, so the single approval flips it to APPROVED —
  // confirmed on the owner's page via SSE (review.updated).
  await expect(owner.getByTestId("doc-state")).toHaveText("Approved", { timeout: 10_000 });
  await expect(owner.getByTestId("approval-progress")).toHaveText("1 of 1 approvals");

  await removeParticipant(owner, reviewerEmail);

  // The dismissed review drops the approval count and the state falls back out of APPROVED.
  await expect(owner.getByTestId("doc-state")).toHaveText("Open", { timeout: 10_000 });
  await expect(owner.getByTestId("approval-progress")).toHaveText("0 of 1 approvals");

  // The removed reviewer no longer has access (see the loading.tsx note above
  // for why this doesn't assert on the navigation's HTTP status).
  await reviewer.goto(url);
  await expect(reviewer.getByText(NOT_FOUND_TEXT)).toBeVisible();

  await ownerCtx.close();
  await reviewerCtx.close();
});
