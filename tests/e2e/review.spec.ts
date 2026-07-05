import { test, expect, type Page } from "@playwright/test";

// Web docs are PRIVATE by default; flip to LINK using the owner's authenticated
// context so a second user can open the URL and auto-join as REVIEWER,
// mirroring the pre-M8 link-grant behavior these collaboration specs rely on.
async function makeLinkVisible(owner: Page, docUrl: string): Promise<void> {
  const docId = docUrl.split("/documents/")[1];
  const res = await owner.request.patch(`/api/documents/${docId}/settings`, { data: { visibility: "LINK" } });
  expect(res.ok()).toBeTruthy();
}

async function register(page: Page, name: string): Promise<void> {
  const email = `rev-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill(name);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("create, annotate, comment, request changes", async ({ browser }) => {
  // Owner A creates, annotates, and comments. Owners can't issue verdicts on
  // their own document (M4-P1), so a non-owner participant B requests changes.
  const ctxA = await browser.newContext();
  const page = await ctxA.newPage();
  await register(page, "Owner");

  // create a doc
  await page.getByLabel("title").fill("Infra Plan");
  await page.getByLabel("markdown").fill("The cloud setup needs review before launch.");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/documents\//);
  const url = page.url();

  // select the phrase "cloud setup" in the rendered body
  await page.getByTestId("doc-body").getByText("cloud setup").first().selectText();
  await page.getByLabel("comment").fill("which cloud provider?");
  await page.getByRole("button", { name: "Comment", exact: true }).click();

  // thread appears with the comment, and a highlight exists
  await expect(page.getByTestId("thread")).toContainText("which cloud provider?");
  await expect(page.locator("mark[data-annotation-id]")).toHaveCount(1);

  await makeLinkVisible(page, url);

  // Reviewer B joins via link-grant and requests changes.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await register(pageB, "Reviewer");
  await pageB.goto(url);
  // Wait for the client component to hydrate (it POSTs presence on mount) before
  // clicking the server-rendered button, or the click is a no-op against an un-wired handler.
  await pageB.waitForResponse(
    (r) => r.url().includes(`/presence`) && r.request().method() === "POST",
  );
  await expect(pageB.getByTestId("doc-body")).toContainText("cloud setup");
  await pageB.getByRole("button", { name: "Request changes" }).click();

  // Owner A sees the verdict propagate via SSE → state badge updates.
  await expect(page.getByTestId("doc-state")).toHaveText("Changes requested", { timeout: 10_000 });

  await ctxA.close();
  await ctxB.close();
});
