import { test, expect, type Page } from "@playwright/test";

async function register(page: Page, name: string): Promise<string> {
  const email = `rr-${name.toLowerCase()}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
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

/** Owner (on the document page) shares with `email` at `role`, optionally as a required reviewer. */
async function shareWith(owner: Page, email: string, role: "REVIEWER" | "VIEWER", required = false) {
  await owner.getByTestId("share-document").click();
  const dialog = shareDialog(owner);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("email").fill(email);
  // Scoped exact: after the first share, a per-row "role for <email>" select
  // exists in the "People with access" list, and getByLabel does substring
  // matching, so an unqualified "role" would resolve to both.
  await dialog.getByLabel("role", { exact: true }).selectOption(role);
  if (required) await dialog.getByLabel("required reviewer").check();
  const shared = owner.waitForResponse((r) => r.url().endsWith("/participants") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Share" }).click();
  expect((await shared).ok()).toBeTruthy();
  await dialog.getByRole("button", { name: "Close" }).click();
}

/** Opens the doc, waits for hydration (presence POST on mount), then clicks Approve. */
async function approve(reviewer: Page, url: string) {
  await reviewer.goto(url);
  // The Approve button is server-rendered; wait for the client component to hydrate
  // (it POSTs presence on mount) before clicking, or the click is a no-op against an
  // un-wired handler and the review never registers.
  await reviewer.waitForResponse((r) => r.url().includes("/presence") && r.request().method() === "POST");
  const approved = reviewer.waitForResponse((r) => r.url().includes("/reviews") && r.request().method() === "POST");
  await reviewer.getByRole("button", { name: "Approve" }).click();
  expect((await approved).ok()).toBeTruthy();
}

test("a required reviewer gates APPROVED, gets a review-requested notification, and is queued as blocking", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await register(owner, "Owner");

  const requiredCtx = await browser.newContext();
  const requiredReviewer = await requiredCtx.newPage();
  const requiredEmail = await register(requiredReviewer, "Required");

  const plainCtx = await browser.newContext();
  const plainReviewer = await plainCtx.newPage();
  const plainEmail = await register(plainReviewer, "Plain");

  const title = "Required Reviewer Rollout";
  const url = await createDoc(owner, title, "This launch needs sign-off from the required reviewer.");

  await shareWith(owner, requiredEmail, "REVIEWER", true);
  await shareWith(owner, plainEmail, "REVIEWER", false);

  // The required reviewer gets an in-app review-requested notification.
  await requiredReviewer.goto("/inbox");
  await expect(requiredReviewer.getByTestId("notification").first()).toHaveText(/requested your review/i);

  // Home queues: required reviewer sees it as "Blocking on you"; the plain
  // reviewer sees the same doc under "Open reviews".
  await requiredReviewer.goto("/");
  await expect(
    requiredReviewer.locator('[data-testid="queue-blocking"]').getByText(title),
  ).toBeVisible();

  await plainReviewer.goto("/");
  await expect(
    plainReviewer.locator('[data-testid="queue-open-reviews"]').getByText(title),
  ).toBeVisible();

  // The plain reviewer's approval alone meets requiredApprovals (default 1) but
  // must NOT flip the doc to APPROVED — the required reviewer hasn't approved yet.
  await approve(plainReviewer, url);
  await expect(owner.getByTestId("doc-state")).toHaveText("Open", { timeout: 10_000 });
  await expect(owner.getByTestId("approval-progress")).toHaveText("1 of 1 approvals");

  // Once the required reviewer also approves, the gate is satisfied and the
  // doc becomes APPROVED (propagated to the owner via SSE).
  await approve(requiredReviewer, url);
  await expect(owner.getByTestId("doc-state")).toHaveText("Approved", { timeout: 10_000 });

  await ownerCtx.close();
  await requiredCtx.close();
  await plainCtx.close();
});
