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

  // The physician's second opinion over the confirmed value, profile filled in first.
  const profileUrl = page.url();
  await page.goto(`${profileUrl}?tab=plan`);
  const basics = page.getByTestId("medical-profile").getByRole("region", { name: "Основное" });
  for (const [kind, value] of [
    ["sex", "female"],
    ["birth_year", "1992"],
  ] as const) {
    await basics.getByRole("button", { name: "Добавить" }).click();
    await basics.getByLabel("Что записать").selectOption(kind);
    if (kind === "sex") await basics.getByLabel("Значение").selectOption(value);
    else await basics.getByLabel("Значение").fill(value);
    await basics.getByRole("button", { name: "Сохранить" }).click();
  }
  await expect(basics.getByText("1992")).toBeVisible();
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
  await assistant.scrollIntoViewIfNeeded();
  await screenshot(page, "assistant.png");
});

test("capture the консилиум screenshot", async ({ page }) => {
  await openReview(page);
  for (const [factKey, name, value, unit] of [
    ["synthetic-analyte-a", "ТТГ", "6.8", "мМЕ/л"],
    ["synthetic-analyte-b", "Гемоглобин", "9.8", "г/дл"],
  ] as const) {
    const workspace = reviewWorkspace(page);
    await resultCard(page, factKey).click();
    await workspace.getByRole("button", { name: "Исправить результат" }).click();
    const correction = workspace.getByRole("form", { name: "Исправление результата" });
    await correction.getByLabel("Корректное название").fill(name);
    await correction.getByLabel("Корректное значение").fill(value);
    await correction.getByLabel("Корректная единица").fill(unit);
    await correction.getByRole("button", { name: "Сохранить исправление" }).click();
    await resultCard(page, factKey).click();
    await expect(workspace.getByText("Исправлено и подтверждено", { exact: true })).toBeVisible();
  }
  const profileUrl = page.url().replace(/\/documents\/[0-9a-f-]{36}$/, "");
  await page.goto(`${profileUrl}?tab=plan`);
  const basics = page.getByTestId("medical-profile").getByRole("region", { name: "Основное" });
  for (const [kind, value] of [
    ["sex", "female"],
    ["birth_year", "1990"],
  ] as const) {
    await basics.getByRole("button", { name: "Добавить" }).click();
    await basics.getByLabel("Что записать").selectOption(kind);
    if (kind === "sex") await basics.getByLabel("Значение").selectOption(value);
    else await basics.getByLabel("Значение").fill(value);
    await basics.getByRole("button", { name: "Сохранить" }).click();
  }
  await expect(basics.getByText("1990")).toBeVisible();
  await page.goto(`${profileUrl}/assistants/physician`);
  const assistant = page.getByTestId("assistant-workspace");
  await assistant.getByRole("button", { name: "Создать диалог" }).click();
  await assistant.getByLabel("Название диалога").fill("Консилиум по анализам");
  await assistant.getByRole("button", { name: "Создать", exact: true }).click();
  await page.getByTestId("assistant-egress-gate").getByRole("button").click();
  await assistant.getByLabel("Сообщение ИИ-врачу").fill("Что вы думаете все вместе?");
  await assistant.getByRole("button", { name: "Собрать консилиум" }).click();
  const synthesis = page.getByTestId("assistant-answer").filter({ hasText: "синтез консилиума" });
  await expect(synthesis).toBeVisible({ timeout: 60_000 });
  await synthesis.getByTestId("assistant-consilium").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -80));
  await screenshot(page, "consilium.png");
});
