import { mkdir } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { openReview, resultCard, reviewWorkspace } from "./support/review";

/**
 * Regenerates the README screenshots from a fresh synthetic family on the e2e stand:
 *
 *   README_SCREENSHOTS=1 pnpm test:e2e e2e/readme-screenshots.spec.ts
 *
 * Skipped otherwise, so CI never rewrites docs/media. Everything on screen is synthetic —
 * a generated family, the checked-in fixture report, the fake Codex answer.
 */
const enabled = process.env.README_SCREENSHOTS === "1";
const mediaDirectory = new URL("../docs/media/", import.meta.url);

test.skip(!enabled, "set README_SCREENSHOTS=1 to regenerate docs/media");
test.use({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });

async function screenshot(page: Page, name: string): Promise<void> {
  await mkdir(mediaDirectory, { recursive: true });
  // The Next.js dev indicator is not part of the product.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: new URL(name, mediaDirectory).pathname, animations: "disabled" });
}

test("capture the README screenshots", async ({ page }) => {
  await openReview(page);
  const workspace = reviewWorkspace(page);
  await expect(resultCard(page, "synthetic-analyte-a")).toHaveAttribute("aria-pressed", "true");
  await workspace.getByTestId("document-review-source").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 0));
  await screenshot(page, "document.png");

  await workspace.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -24));
  await screenshot(page, "review.png");

  await workspace.getByRole("button", { name: "Подтвердить результат" }).click();
  await expect(workspace.locator(".document-review-workspace__notice")).toHaveText(
    "Подтверждено пользователем",
  );

  const tabs = page.getByRole("tablist", { name: "Основные разделы профиля" });
  await tabs.getByRole("tab", { name: "Документы", exact: true }).click();
  await expect(page).toHaveURL(/\?tab=documents$/);
  await expect(page.getByRole("heading", { name: "Документы профиля" })).toBeVisible();
  await screenshot(page, "documents.png");

  await tabs.getByRole("tab", { name: "Обзор", exact: true }).click();
  await expect(page).not.toHaveURL(/tab=/);
  await screenshot(page, "overview.png");
});
