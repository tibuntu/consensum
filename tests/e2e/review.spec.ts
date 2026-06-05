import { test, expect } from "@playwright/test";

test("create, annotate, comment, request changes", async ({ page }) => {
  const email = `rev-${Date.now()}@example.com`;
  // register
  await page.goto("/register");
  await page.getByLabel("name").fill("Reviewer");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);

  // create a doc
  await page.getByLabel("title").fill("Infra Plan");
  await page.getByLabel("markdown").fill("The cloud setup needs review before launch.");
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/app\/documents\//);

  // select the phrase "cloud setup" in the rendered body
  await page.getByTestId("doc-body").getByText("cloud setup").first().selectText();
  await page.getByLabel("comment").fill("which cloud provider?");
  await page.getByRole("button", { name: "Comment" }).click();

  // thread appears with the comment, and a highlight exists
  await expect(page.getByTestId("thread")).toContainText("which cloud provider?");
  await expect(page.locator("mark[data-annotation-id]")).toHaveCount(1);

  // request changes → state badge updates
  await page.getByRole("button", { name: "Request changes" }).click();
  await expect(page.getByTestId("doc-state")).toHaveText("Changes requested");
});
