import { test, expect, type Page } from "@playwright/test";

async function register(page: Page, name: string): Promise<void> {
  const email = `hint-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill(name);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function makeLinkVisible(owner: Page, docUrl: string): Promise<void> {
  const docId = docUrl.split("/documents/")[1];
  const res = await owner.request.patch(`/api/documents/${docId}/settings`, { data: { visibility: "LINK" } });
  expect(res.ok()).toBeTruthy();
}

async function createDoc(owner: Page): Promise<string> {
  await owner.getByLabel("title").fill("Hint Plan");
  await owner.getByLabel("markdown").fill("The rollout strategy needs eyes.");
  await owner.getByRole("button", { name: "Create document" }).click();
  await expect(owner).toHaveURL(/\/documents\//);
  const url = owner.url();
  await makeLinkVisible(owner, url);
  return url;
}

test("hint shows for reviewer, not owner; X dismissal survives reload", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const owner = await ctxA.newPage();
  await register(owner, "Owner");
  const url = await createDoc(owner);
  // Owner never sees the reviewer hint.
  await expect(owner.getByTestId("doc-body")).toBeVisible();
  await expect(owner.getByTestId("reviewer-hint")).toHaveCount(0);

  const ctxB = await browser.newContext();
  const reviewer = await ctxB.newPage();
  await register(reviewer, "Reviewer");
  await reviewer.goto(url);
  await expect(reviewer.getByTestId("reviewer-hint")).toBeVisible();

  await reviewer.reload();
  await expect(reviewer.getByTestId("reviewer-hint")).toBeVisible();

  await reviewer.getByRole("button", { name: "dismiss reviewer hint" }).click();
  await expect(reviewer.getByTestId("reviewer-hint")).toHaveCount(0);
  await reviewer.reload();
  await expect(reviewer.getByTestId("doc-body")).toBeVisible();
  await expect(reviewer.getByTestId("reviewer-hint")).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

test("posting a comment auto-dismisses the hint", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const owner = await ctxA.newPage();
  await register(owner, "Owner");
  const url = await createDoc(owner);

  const ctxC = await browser.newContext();
  const reviewer = await ctxC.newPage();
  await register(reviewer, "Commenter");
  await reviewer.goto(url);
  await expect(reviewer.getByTestId("reviewer-hint")).toBeVisible();

  await reviewer.getByTestId("doc-body").getByText("rollout strategy").first().selectText();
  await reviewer.getByLabel("comment").fill("which regions first?");
  await reviewer.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(reviewer.getByTestId("thread")).toContainText("which regions first?");
  await expect(reviewer.getByTestId("reviewer-hint")).toHaveCount(0);
  await reviewer.reload();
  await expect(reviewer.getByTestId("doc-body")).toBeVisible();
  await expect(reviewer.getByTestId("reviewer-hint")).toHaveCount(0);

  await ctxA.close();
  await ctxC.close();
});
