import { test, expect, type Page } from "@playwright/test";

async function register(page: Page, name: string): Promise<string> {
  const email = `rf-${name.toLowerCase()}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill(name);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);
  return email;
}

async function makeLinkVisible(owner: Page, docUrl: string): Promise<void> {
  const docId = docUrl.split("/documents/")[1];
  const res = await owner.request.patch(`/api/documents/${docId}/settings`, { data: { visibility: "LINK" } });
  expect(res.ok()).toBeTruthy();
}

async function setEditorText(page: Page, text: string) {
  const editor = page.getByTestId("editor").locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await editor.type(text);
}

/** Waits for hydration (presence POST on mount), then submits the given verdict. */
async function review(reviewer: Page, url: string, button: "Approve" | "Request changes") {
  await reviewer.goto(url);
  await reviewer.waitForResponse((r) => r.url().includes("/presence") && r.request().method() === "POST");
  const posted = reviewer.waitForResponse((r) => r.url().includes("/reviews") && r.request().method() === "POST");
  await reviewer.getByRole("button", { name: button }).click();
  expect((await posted).ok()).toBeTruthy();
}

test("stale request-changes re-queues the reviewer and shows the since-your-review diff", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await register(owner, "Owner");

  const title = "Freshness Rollout";
  await owner.goto("/");
  await owner.getByLabel("title").fill(title);
  await owner.getByLabel("markdown").fill("The quick brown fox jumps over the lazy dog.");
  await owner.getByRole("button", { name: "Create document" }).click();
  await expect(owner).toHaveURL(/\/documents\//);
  const url = owner.url();
  await makeLinkVisible(owner, url);

  const reviewerCtx = await browser.newContext();
  const reviewer = await reviewerCtx.newPage();
  await register(reviewer, "Reviewer");
  await review(reviewer, url, "Request changes");

  // Owner sees the objection land, then pushes v2.
  await expect(owner.getByTestId("doc-state")).toHaveText("Changes requested", { timeout: 10_000 });
  await owner.getByRole("button", { name: "Edit" }).click();
  await setEditorText(owner, "The quick brown wolf jumps over the lazy dog.");
  await owner.getByRole("button", { name: "Save" }).click();

  // Conservative semantics: the push does NOT clear the objection.
  await expect(owner.getByTestId("doc-state")).toHaveText("Changes requested");

  // The reviewer is re-queued with the re-review hint.
  await reviewer.goto("/");
  const queued = reviewer.locator('[data-testid="queue-open-reviews"]');
  await expect(queued.getByText(title)).toBeVisible();
  await expect(queued.getByTestId("re-review-hint")).toHaveText("Changed since your review");

  // Banner + inline diff on the document page.
  await reviewer.goto(url);
  await expect(reviewer.getByTestId("stale-review-banner")).toContainText("You reviewed v1 · document is now v2");
  await reviewer.getByTestId("stale-diff-toggle").click();
  await expect(reviewer.getByTestId("stale-diff")).toBeVisible();
  await expect(reviewer.getByTestId("stale-diff")).toContainText("wolf");

  // Re-review clears the block; the doc approves (requiredApprovals default 1).
  await review(reviewer, url, "Approve");
  await expect(owner.getByTestId("doc-state")).toHaveText("Approved", { timeout: 10_000 });

  await ownerCtx.close();
  await reviewerCtx.close();
});
