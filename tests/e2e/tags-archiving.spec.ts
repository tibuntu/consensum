import { test, expect, type Page } from "@playwright/test";

async function register(page: Page, name: string): Promise<string> {
  const email = `ta-${name.toLowerCase()}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
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

async function addTagViaDialog(page: Page, tag: string) {
  await page.getByTestId("share-document").click();
  const dialog = shareDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("new tag").fill(tag);
  const saved = page.waitForResponse((r) => r.url().includes("/settings") && r.request().method() === "PATCH");
  await dialog.getByRole("button", { name: "Add" }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(dialog.getByTestId(`tag-${tag}`)).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
}

async function toggleArchive(page: Page) {
  const saved = page.waitForResponse((r) => r.url().includes("/settings") && r.request().method() === "PATCH");
  await page.getByTestId("archive-document").click();
  expect((await saved).ok()).toBeTruthy();
}

test("tag → filter → archive → reveal → unarchive round trip", async ({ page }) => {
  await register(page, "Owner");
  const taggedTitle = `Tagged Plan ${Date.now()}`;
  const plainTitle = `Plain Plan ${Date.now()}`;
  const url = await createDoc(page, taggedTitle, "Tagged body.");
  await createDoc(page, plainTitle, "Plain body.");

  await page.goto(url);
  await addTagViaDialog(page, "security");

  // Chip appears; filtering narrows to the tagged doc only.
  await page.goto("/");
  await expect(page.getByText(taggedTitle)).toBeVisible();
  await expect(page.getByText(plainTitle)).toBeVisible();
  await page.getByTestId("tag-chip-security").click();
  await expect(page).toHaveURL(/tag=security/);
  await expect(page.getByText(taggedTitle)).toBeVisible();
  await expect(page.getByText(plainTitle)).toHaveCount(0);
  // Clearing: clicking the active chip removes the filter.
  await page.getByTestId("tag-chip-security").click();
  await expect(page.getByText(plainTitle)).toBeVisible();

  // Archive: banner appears, doc leaves home, toggle reveals it.
  await page.goto(url);
  await toggleArchive(page);
  await expect(page.getByTestId("archived-banner")).toBeVisible();
  await page.goto("/");
  await expect(page.getByText(taggedTitle)).toHaveCount(0);
  await page.getByTestId("toggle-archived").click();
  await expect(page).toHaveURL(/archived=1/);
  await expect(page.getByText(taggedTitle)).toBeVisible();

  // Unarchive restores.
  await page.goto(url);
  await expect(page.getByTestId("archive-document")).toHaveText("Unarchive");
  await toggleArchive(page);
  await expect(page.getByTestId("archived-banner")).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByText(taggedTitle)).toBeVisible();
});

test("archived doc is read-only for a reviewer", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await register(owner, "Owner");

  const reviewerCtx = await browser.newContext();
  const reviewer = await reviewerCtx.newPage();
  const reviewerEmail = await register(reviewer, "Reviewer");

  const title = `Archived Readonly ${Date.now()}`;
  const url = await createDoc(owner, title, "Needs review, then gets archived.");

  // Share with the reviewer.
  await owner.getByTestId("share-document").click();
  const dialog = shareDialog(owner);
  await dialog.getByLabel("email").fill(reviewerEmail);
  const shared = owner.waitForResponse((r) => r.url().endsWith("/participants") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Share" }).click();
  expect((await shared).ok()).toBeTruthy();
  await dialog.getByRole("button", { name: "Close" }).click();

  // Reviewer sees review controls while active.
  await reviewer.goto(url);
  await expect(reviewer.getByRole("button", { name: "Approve" })).toBeVisible();

  // Owner archives; reviewer now gets the banner and no verdict buttons.
  await owner.goto(url);
  await toggleArchive(owner);
  await reviewer.reload();
  await expect(reviewer.getByTestId("archived-banner")).toBeVisible();
  await expect(reviewer.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(reviewer.getByRole("button", { name: "Request changes" })).toHaveCount(0);

  await ownerCtx.close();
  await reviewerCtx.close();
});
