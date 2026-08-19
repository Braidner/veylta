import { mkdir } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { recordBasics } from "./support/dossier";
import { correctResult, openReview, resultCard, reviewWorkspace } from "./support/review";
import { profileHandleUrl } from "./support/urls";

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
  await expect(page).toHaveURL(/\/[a-z0-9-]+\/docs$/);
  await expect(page.getByRole("region", { name: "Архив документов" })).toBeVisible();
  // One value is still undecided, so the document is shot where it actually is: in the queue.
  await expect(page.getByRole("region", { name: "Очередь" })).toBeVisible();
  await screenshot(page, "documents.png");

  await tabs.getByRole("tab", { name: "Обзор", exact: true }).click();
  await expect(page).toHaveURL(profileHandleUrl);
  await screenshot(page, "overview.png");

  // The physician's second opinion over the confirmed value, profile filled in first.
  const profileUrl = page.url();
  await recordBasics(page, profileUrl, { sex: "female", birthYear: "1992" });
  await page.goto(`${profileUrl}/assistants/physician`);
  const assistant = page.getByTestId("assistant-workspace");
  await assistant.getByRole("button", { name: "Создать диалог" }).click();
  await assistant.getByLabel("Название диалога").fill("Разбор анализов за август");
  await assistant.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page.getByTestId("assistant-egress-gate")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await screenshot(page, "assistant-gate.png");
  await page.getByTestId("assistant-egress-gate").getByRole("button").click();
  await assistant.getByLabel("Сообщение ИИ-врачу").fill("Что значат мои последние анализы?");
  await assistant.getByRole("button", { name: "Отправить" }).click();
  await expect(page.getByTestId("assistant-answer")).toBeVisible({ timeout: 60_000 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await screenshot(page, "assistant.png");
});

test("capture the консилиум screenshot", async ({ page }) => {
  await openReview(page);
  await correctResult(page, "synthetic-analyte-a", { name: "ТТГ", value: "6.8", unit: "мМЕ/л" });
  await correctResult(page, "synthetic-analyte-b", {
    name: "Гемоглобин",
    value: "9.8",
    unit: "г/дл",
  });
  const profileUrl = page.url().replace(/\/docs\/[0-9a-f-]{36}$/, "");
  await recordBasics(page, profileUrl, { sex: "female", birthYear: "1990" });
  // The dossier: passport, Veylta's own reading of the two values, their dynamics.
  await expect(page.getByTestId("dossier-attention")).toContainText("Требуют внимания");
  await expect(page.getByTestId("dossier-gauge")).toHaveCount(1);
  // The dossier is one tall page — passport, assessment, dynamics — so this frame is taller.
  await page.setViewportSize({ width: 1440, height: 1320 });
  await page.evaluate(() => {
    const passport = document.querySelector('[data-testid="dossier-passport"]');
    if (passport !== null)
      window.scrollTo(0, passport.getBoundingClientRect().top + window.scrollY - 104);
  });
  await screenshot(page, "dossier.png");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${profileUrl}/assistants/physician`);
  const assistant = page.getByTestId("assistant-workspace");
  await assistant.getByRole("button", { name: "Создать диалог" }).click();
  await assistant.getByLabel("Название диалога").fill("Консилиум по анализам");
  await assistant.getByRole("button", { name: "Создать", exact: true }).click();
  await page.getByTestId("assistant-egress-gate").getByRole("button").click();
  await page
    .getByTestId("assistant-consilium-panel")
    .getByRole("button", { name: /Консилиум/ })
    .click();
  await assistant.getByLabel("Вопрос консилиуму").fill("Что вы думаете все вместе?");
  await assistant.getByRole("button", { name: "Собрать консилиум" }).click();
  const synthesis = page.getByTestId("assistant-answer").filter({ hasText: "синтез консилиума" });
  await expect(synthesis).toBeVisible({ timeout: 60_000 });
  // The synthesis with the opinions under it, above the composer held at the bottom.
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.evaluate(() => {
    const answer = [...document.querySelectorAll('[data-testid="assistant-answer"]')].at(-1);
    if (answer !== undefined)
      window.scrollTo(0, answer.getBoundingClientRect().top + window.scrollY - 100);
  });
  await screenshot(page, "consilium.png");
});
