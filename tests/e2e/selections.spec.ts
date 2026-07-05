import { test, expect, type Page } from "@playwright/test";

async function register(page: Page, name: string): Promise<void> {
  const email = `${name.toLowerCase()}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill(name);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function createDoc(page: Page, title: string, markdown: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("title").fill(title);
  await page.getByLabel("markdown").fill(markdown);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/documents\/[^/]+$/);
  return page.url();
}

// Web docs are PRIVATE by default; flip to LINK using the owner's authenticated
// context so a second user can open the URL and auto-join as REVIEWER,
// mirroring the pre-M8 link-grant behavior these collaboration specs rely on.
async function makeLinkVisible(owner: Page, docUrl: string): Promise<void> {
  const docId = docUrl.split("/documents/")[1];
  const res = await owner.request.patch(`/api/documents/${docId}/settings`, { data: { visibility: "LINK" } });
  expect(res.ok()).toBeTruthy();
}

test("remote selection appears as a tinted mark and clears on collapse", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await register(pageA, "Ada");
  const docUrl = await createDoc(pageA, "Selection demo", "# Hello\n\nReview me together.\n\nAnother paragraph here.");
  await makeLinkVisible(pageA, docUrl);

  await register(pageB, "Grace");
  await pageB.goto(docUrl);
  await expect(pageB.getByTestId("doc-body")).toBeVisible();
  // Both in the roster → SSE channel is live on both sides.
  await expect(pageA.getByTestId("presence-roster")).toHaveAttribute("aria-label", /2 people viewing/);

  // B selects a sentence; A sees a presence mark carrying B's name.
  await pageB.getByTestId("doc-body").getByText("Review me together.").first().selectText();
  const remoteMark = pageA.locator("mark[data-presence-user-id]");
  await expect(remoteMark).toHaveCount(1);
  await expect(remoteMark).toHaveAttribute("data-user-name", "Grace");
  await expect(remoteMark).toHaveAttribute("title", "Grace");
  await expect(remoteMark).toHaveText("Review me together.");
  // B never renders its own selection as a remote mark.
  await expect(pageB.locator("mark[data-presence-user-id]")).toHaveCount(0);

  // B collapses; A's mark disappears.
  await pageB.evaluate(() => document.getSelection()?.removeAllRanges());
  await expect(remoteMark).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

test("remote selection coexists with an annotation highlight", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await register(pageA, "Ada");
  const docUrl = await createDoc(pageA, "Coexistence demo", "The cloud setup needs review before launch.\n\nReview me together.");

  // A creates an annotation (mirrors review.spec.ts).
  await pageA.getByTestId("doc-body").getByText("cloud setup").first().selectText();
  await pageA.getByLabel("comment").fill("which cloud provider?");
  await pageA.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(pageA.locator("mark[data-annotation-id]")).toHaveCount(1);

  await makeLinkVisible(pageA, docUrl);
  await register(pageB, "Grace");
  await pageB.goto(docUrl);
  await expect(pageB.getByTestId("doc-body")).toBeVisible();
  await expect(pageA.getByTestId("presence-roster")).toHaveAttribute("aria-label", /2 people viewing/);

  // B selects the other paragraph; A sees both layers at once.
  await pageB.getByTestId("doc-body").getByText("Review me together.").first().selectText();
  await expect(pageA.locator("mark[data-presence-user-id]")).toHaveCount(1);
  await expect(pageA.locator("mark[data-annotation-id]")).toHaveCount(1);

  await ctxA.close();
  await ctxB.close();
});
