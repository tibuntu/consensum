import { test, expect, type Page, type BrowserContext } from "@playwright/test";

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

async function countEventSources(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as { __esCount: number; EventSource: typeof EventSource };
    w.__esCount = 0;
    const Native = w.EventSource;
    class Counting extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        w.__esCount += 1;
      }
    }
    w.EventSource = Counting as unknown as typeof EventSource;
  });
}

// Web docs are PRIVATE by default; flip to LINK using the owner's authenticated
// context so a second user can open the URL and auto-join as REVIEWER,
// mirroring the pre-M8 link-grant behavior these collaboration specs rely on.
async function makeLinkVisible(owner: Page, docUrl: string): Promise<void> {
  const docId = docUrl.split("/documents/")[1];
  const res = await owner.request.patch(`/api/documents/${docId}/settings`, { data: { visibility: "LINK" } });
  expect(res.ok()).toBeTruthy();
}

async function moveOverDocBody(page: Page): Promise<void> {
  const box = await page.getByTestId("doc-body").boundingBox();
  if (!box) throw new Error("doc-body has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
}

test("remote cursor appears on move and clears when the pointer leaves the doc", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  await countEventSources(ctxA);
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await register(pageA, "Ada");
  const docUrl = await createDoc(pageA, "Cursor demo", "# Hello\n\nReview me together.\n\nAnother paragraph here.");
  await makeLinkVisible(pageA, docUrl);

  await register(pageB, "Grace");
  await pageB.goto(docUrl);
  await expect(pageB.getByTestId("doc-body")).toBeVisible();
  await expect(pageA.getByTestId("presence-roster")).toHaveAttribute("aria-label", /2 people viewing/);

  await moveOverDocBody(pageB);
  const remoteCursor = pageA.locator("[data-presence-cursor-user-id]");
  await expect(remoteCursor).toHaveCount(1);
  await expect(remoteCursor).toHaveAttribute("data-user-name", "Grace");
  await expect(pageB.locator("[data-presence-cursor-user-id]")).toHaveCount(0);

  await pageB.mouse.move(2, 2, { steps: 2 });
  await expect(remoteCursor).toHaveCount(0);

  const esCount = await pageA.evaluate(() => (window as unknown as { __esCount: number }).__esCount);
  expect(esCount).toBe(2);

  await ctxA.close();
  await ctxB.close();
});

test("a remote cursor and a remote selection coexist", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await register(pageA, "Ada");
  const docUrl = await createDoc(pageA, "Cursor+selection demo", "# Hello\n\nReview me together.\n\nAnother paragraph here.");
  await makeLinkVisible(pageA, docUrl);

  await register(pageB, "Grace");
  await pageB.goto(docUrl);
  await expect(pageB.getByTestId("doc-body")).toBeVisible();
  await expect(pageA.getByTestId("presence-roster")).toHaveAttribute("aria-label", /2 people viewing/);

  await pageB.getByTestId("doc-body").getByText("Review me together.").first().selectText();
  await moveOverDocBody(pageB);
  await expect(pageA.locator("mark[data-presence-user-id]")).toHaveCount(1);
  await expect(pageA.locator("[data-presence-cursor-user-id]")).toHaveCount(1);

  await ctxA.close();
  await ctxB.close();
});
