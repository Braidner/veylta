import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { distinctSyntheticDocument, uploadSyntheticDocument } from "./support/document-upload";
import { createSyntheticFamily } from "./support/synthetic-family";

const syntheticLabFixture = new URL("../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url);
const syntheticLabBytes = await readFile(syntheticLabFixture);

function syntheticNames() {
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    owner: `Владелец history ${suffix}`,
    family: `Семья history ${suffix}`,
    profile: `Профиль history ${suffix}`,
  };
}

async function registerDemoFamily(page: Page): Promise<string> {
  const names = syntheticNames();
  return createSyntheticFamily(page, names);
}

async function uploadAndOpenReview(page: Page, filename: string): Promise<void> {
  await uploadSyntheticDocument(page, {
    name: filename,
    mimeType: "application/pdf",
    buffer: distinctSyntheticDocument(syntheticLabBytes, filename),
  });
  await expect(page).toHaveURL(/\/[a-z0-9-]+\/docs\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Результаты исследования" })).toBeVisible();
}

function factCard(page: Page, position: number): Locator {
  return page.locator(".document-result-card--selectable").nth(position);
}

async function confirmAndReject(page: Page): Promise<void> {
  await factCard(page, 0).click();
  await page.getByRole("button", { name: "Подтвердить результат" }).click();
  await expect(factCard(page, 0).locator(".document-result-status")).toHaveText(
    "Подтверждено пользователем",
  );
  await factCard(page, 1).click();
  await page.getByRole("button", { name: "Отклонить результат" }).click();
  await expect(factCard(page, 1).locator(".document-result-status")).toHaveText(
    "Отклонено пользователем",
  );
  await expect(page.getByRole("heading", { name: "Извлечение завершено" })).toBeVisible();
}

async function correctAndReject(page: Page, correctedValue: string): Promise<void> {
  const firstFact = factCard(page, 0);
  await firstFact.click();
  await page.getByRole("button", { name: "Исправить результат" }).click();
  await page.getByLabel("Корректное значение").fill(correctedValue);
  await page.getByRole("button", { name: "Сохранить исправление" }).click();
  await expect(firstFact.locator(".document-result-status")).toHaveText(
    "Подтверждено пользователем",
  );
  await factCard(page, 1).click();
  await page.getByRole("button", { name: "Отклонить результат" }).click();
  await expect(page.getByRole("heading", { name: "Извлечение завершено" })).toBeVisible();
}

test("profile history shows confirmed and corrected observations with their authorized sources only", async ({
  page,
}) => {
  const profileUrl = await registerDemoFamily(page);

  await uploadAndOpenReview(page, `history-confirm-${crypto.randomUUID().slice(0, 8)}.pdf`);
  await confirmAndReject(page);
  await page.getByRole("tab", { name: "История", exact: true }).click();
  await expect(page).toHaveURL(`${profileUrl}/history`);

  const history = page.getByRole("region", { name: "История подтверждённых значений" });
  await expect(
    history.getByRole("heading", { name: "История подтверждённых значений" }),
  ).toBeVisible();
  await expect(history.locator("tbody tr")).toHaveCount(1);
  await expect(history.getByText("СИНТЕТИЧЕСКИЙ АНАЛИТ A", { exact: true })).toBeVisible();
  await expect(history.getByText("7.0 synthetic-unit", { exact: true })).toBeVisible();
  await expect(history.getByText("СИНТЕТИЧЕСКИЙ АНАЛИТ B", { exact: true })).toHaveCount(0);

  await uploadSyntheticDocument(page, {
    name: `history-correct-${crypto.randomUUID().slice(0, 8)}.pdf`,
    mimeType: "application/pdf",
    buffer: distinctSyntheticDocument(syntheticLabBytes, `history-correct-${profileUrl}`),
  });
  await expect(page.getByRole("heading", { name: "Результаты исследования" })).toBeVisible();
  await correctAndReject(page, "7.1");

  await page.getByRole("tab", { name: "История", exact: true }).click();
  await expect(page).toHaveURL(`${profileUrl}/history`);
  await expect(history.locator("tbody tr")).toHaveCount(2);
  await expect(history.getByText("7.0 synthetic-unit", { exact: true })).toBeVisible();
  await expect(history.getByText("7.1 synthetic-unit", { exact: true })).toBeVisible();
  await expect(history.getByText("СИНТЕТИЧЕСКИЙ АНАЛИТ B", { exact: true })).toHaveCount(0);

  const sourceDetails = history.locator("details").first();
  await sourceDetails.locator("summary").click();
  await expect(sourceDetails.getByText("Нормализованное значение", { exact: true })).toBeVisible();
  await expect(sourceDetails.getByText("Не рассчитано", { exact: true })).toBeVisible();
  await expect(sourceDetails.getByText("Фрагмент из исходника", { exact: true })).toBeVisible();
  await expect(sourceDetails.getByText(/FACT\|synthetic-analyte-a/)).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await sourceDetails.getByRole("link", { name: "Открыть исходник" }).click();
  await expect(await downloadPromise).toBeTruthy();
});

test("profile catalog compares only matching confirmed synthetic units", async ({ page }) => {
  await registerDemoFamily(page);

  await uploadAndOpenReview(page, `indicator-first-${crypto.randomUUID().slice(0, 8)}.pdf`);
  await confirmAndReject(page);
  await page.getByRole("tab", { name: "История", exact: true }).click();

  const catalog = page.getByRole("region", { name: "Подтверждённая динамика" });
  await expect(
    catalog.getByText("Пока нет подтверждённых показателей", { exact: false }),
  ).toHaveCount(0);
  await expect(catalog.getByRole("button", { name: /Синтетический аналит A/ })).toBeVisible();
  await expect(
    catalog.getByText(
      "Нужно хотя бы два подтверждённых значения в этой же единице, чтобы показать изменение.",
      { exact: true },
    ),
  ).toBeVisible();

  await uploadSyntheticDocument(page, {
    name: `indicator-second-${crypto.randomUUID().slice(0, 8)}.pdf`,
    mimeType: "application/pdf",
    buffer: distinctSyntheticDocument(syntheticLabBytes, "indicator-second"),
  });
  await expect(page.getByRole("heading", { name: "Результаты исследования" })).toBeVisible();
  await correctAndReject(page, "7.5");
  await page.getByRole("tab", { name: "История", exact: true }).click();

  await expect(
    catalog.getByText("Последнее значение выше предыдущего на 0.5 в той же единице."),
  ).toBeVisible();
  const timeline = catalog.getByRole("list", { name: "Подтверждённые значения по времени" });
  await expect(timeline.getByText("7.0 synthetic-unit", { exact: true })).toBeVisible();
  await expect(timeline.getByText("7.5 synthetic-unit", { exact: true })).toBeVisible();
  await expect(
    catalog.getByRole("img", { name: "Расположение подтверждённых значений по времени" }),
  ).toBeVisible();
  await expect(catalog.getByText(/шкала не означает референсный диапазон/i)).toBeVisible();
  await expect(catalog.getByRole("link", { name: "Источник" })).toHaveCount(2);
});
