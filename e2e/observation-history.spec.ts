import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

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
  await page.goto("/");
  await page.getByLabel("Имя владельца").fill(names.owner);
  await page.getByLabel("Название семьи").fill(names.family);
  await page.getByLabel("Имя профиля").fill(names.profile);
  await page.getByRole("button", { name: "Создать пространство" }).click();
  await expect(page).toHaveURL(/\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}$/);
  return page.url();
}

async function uploadAndOpenReview(page: Page, filename: string): Promise<void> {
  await page.getByLabel("Синтетический PDF", { exact: true }).setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: syntheticLabBytes,
  });
  await page.getByRole("button", { name: "Загрузить PDF" }).click();
  await expect(page).toHaveURL(
    /\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}$/,
  );
  await expect(page.getByRole("heading", { name: "Проверьте извлечённые значения" })).toBeVisible();
}

function factCard(page: Page, position: number): Locator {
  return page.locator(".review-fact").nth(position);
}

async function confirmAndReject(page: Page): Promise<void> {
  await factCard(page, 0)
    .getByRole("button", { name: /^Подтвердить / })
    .click();
  await expect(factCard(page, 0).locator(".review-fact__state strong")).toHaveText(
    "Подтверждено пользователем",
  );
  await factCard(page, 1)
    .getByRole("button", { name: /^Отклонить / })
    .click();
  await expect(factCard(page, 1).locator(".review-fact__state strong")).toHaveText(
    "Отклонено пользователем",
  );
  await expect(page.getByRole("heading", { name: "Извлечение завершено" })).toBeVisible();
}

async function correctAndReject(page: Page, correctedValue: string): Promise<void> {
  const firstFact = factCard(page, 0);
  await firstFact.getByRole("button", { name: /^Исправить / }).click();
  await firstFact.getByLabel("Корректное значение").fill(correctedValue);
  await firstFact.getByRole("button", { name: "Сохранить исправление" }).click();
  await expect(firstFact.getByText("Исправлено и подтверждено", { exact: true })).toBeVisible();
  await factCard(page, 1)
    .getByRole("button", { name: /^Отклонить / })
    .click();
  await expect(page.getByRole("heading", { name: "Извлечение завершено" })).toBeVisible();
}

test("profile history shows confirmed and corrected observations with their authorized sources only", async ({
  page,
}) => {
  const profileUrl = await registerDemoFamily(page);

  await uploadAndOpenReview(page, `history-confirm-${crypto.randomUUID().slice(0, 8)}.pdf`);
  await confirmAndReject(page);
  await page.getByRole("link", { name: "Открыть историю подтверждённых значений" }).click();
  await expect(page).toHaveURL(`${profileUrl}#observation-history`);

  const history = page.getByRole("region", { name: "История подтверждённых значений" });
  await expect(
    history.getByRole("heading", { name: "История подтверждённых значений" }),
  ).toBeVisible();
  await expect(history.locator("tbody tr")).toHaveCount(1);
  await expect(history.getByText("СИНТЕТИЧЕСКИЙ АНАЛИТ A", { exact: true })).toBeVisible();
  await expect(history.getByText("7.0 synthetic-unit", { exact: true })).toBeVisible();
  await expect(history.getByText("СИНТЕТИЧЕСКИЙ АНАЛИТ B", { exact: true })).toHaveCount(0);

  await page.getByLabel("Синтетический PDF", { exact: true }).setInputFiles({
    name: `history-correct-${crypto.randomUUID().slice(0, 8)}.pdf`,
    mimeType: "application/pdf",
    buffer: syntheticLabBytes,
  });
  await page.getByRole("button", { name: "Загрузить PDF" }).click();
  await expect(page.getByRole("heading", { name: "Проверьте извлечённые значения" })).toBeVisible();
  await correctAndReject(page, "7.1");

  await page.getByRole("link", { name: "Открыть историю подтверждённых значений" }).click();
  await expect(page).toHaveURL(`${profileUrl}#observation-history`);
  await expect(history.locator("tbody tr")).toHaveCount(2);
  await expect(history.getByText("7.0 synthetic-unit", { exact: true })).toBeVisible();
  await expect(history.getByText("7.1 synthetic-unit", { exact: true })).toBeVisible();
  await expect(history.getByText("СИНТЕТИЧЕСКИЙ АНАЛИТ B", { exact: true })).toHaveCount(0);

  const sourceDetails = history.locator("details").first();
  await sourceDetails.locator("summary").click();
  await expect(sourceDetails.getByText("Нормализованное значение", { exact: true })).toBeVisible();
  await expect(sourceDetails.getByText("Не рассчитано", { exact: true })).toBeVisible();
  await expect(sourceDetails.getByText("Фрагмент из исходного PDF", { exact: true })).toBeVisible();
  await expect(sourceDetails.getByText(/FACT\|synthetic-analyte-a/)).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await sourceDetails.getByRole("link", { name: "Открыть исходный PDF" }).click();
  await expect(await downloadPromise).toBeTruthy();
});

test("profile catalog compares only matching confirmed synthetic units", async ({ page }) => {
  await registerDemoFamily(page);

  await uploadAndOpenReview(page, `indicator-first-${crypto.randomUUID().slice(0, 8)}.pdf`);
  await confirmAndReject(page);
  await page.getByRole("link", { name: "Открыть историю подтверждённых значений" }).click();

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

  await page.getByLabel("Синтетический PDF", { exact: true }).setInputFiles({
    name: `indicator-second-${crypto.randomUUID().slice(0, 8)}.pdf`,
    mimeType: "application/pdf",
    buffer: syntheticLabBytes,
  });
  await page.getByRole("button", { name: "Загрузить PDF" }).click();
  await expect(page.getByRole("heading", { name: "Проверьте извлечённые значения" })).toBeVisible();
  await correctAndReject(page, "7.5");
  await page.getByRole("link", { name: "Открыть историю подтверждённых значений" }).click();

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
  await expect(catalog.getByRole("link", { name: "Источник · PDF" })).toHaveCount(2);
});
