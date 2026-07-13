import { test, expect, type Page } from "@playwright/test";

async function register(page: Page, name: string): Promise<string> {
  const email = `il-${name.toLowerCase()}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
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

test("owner links an implementation; reviewer sees it and is notified; owner removes it", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await register(owner, "Owner");

  await owner.goto("/");
  await owner.getByLabel("title").fill("Linkback Plan");
  await owner.getByLabel("markdown").fill("Ship the linkback feature.");
  await owner.getByRole("button", { name: "Create document" }).click();
  await expect(owner).toHaveURL(/\/documents\//);
  const url = owner.url();
  await makeLinkVisible(owner, url);

  // Reviewer joins via link-grant BEFORE the link is added, so they get the notification.
  const reviewerCtx = await browser.newContext();
  const reviewer = await reviewerCtx.newPage();
  await register(reviewer, "Reviewer");
  await reviewer.goto(url);
  await expect(reviewer.getByTestId("doc-body")).toContainText("linkback");

  // Owner adds a PR link (wait for hydration via the presence POST first).
  await owner.goto(url);
  await owner.waitForResponse((r) => r.url().includes("/presence") && r.request().method() === "POST");
  await owner.getByTestId("add-link-url").fill("https://github.com/acme/repo/pull/42");
  await owner.getByTestId("add-link-label").fill("PR #42");
  await owner.getByTestId("add-link-kind").selectOption("pr");
  const posted = owner.waitForResponse((r) => r.url().includes("/links") && r.request().method() === "POST");
  await owner.getByTestId("add-link-submit").click();
  expect((await posted).ok()).toBeTruthy();
  await expect(owner.getByTestId("implementation-link")).toHaveCount(1);

  // Reviewer sees the link (fresh load) but no add form; inbox has the notification.
  await reviewer.goto(url);
  const linkRow = reviewer.getByTestId("implementation-link");
  await expect(linkRow).toHaveCount(1);
  await expect(linkRow.getByRole("link", { name: "PR #42" })).toHaveAttribute("href", "https://github.com/acme/repo/pull/42");
  await expect(reviewer.getByTestId("add-link-url")).toHaveCount(0);

  await reviewer.goto("/inbox");
  await expect(reviewer.getByTestId("notification").first()).toHaveText(/linked an implementation/i);

  // Owner removes the link.
  await owner.getByRole("button", { name: /remove link PR #42/ }).click();
  await expect(owner.getByTestId("implementation-link")).toHaveCount(0);

  await ownerCtx.close();
  await reviewerCtx.close();
});
