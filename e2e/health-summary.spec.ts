import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { createSyntheticFamily } from "./support/synthetic-family";

const syntheticLabFixture = new URL("../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url);
const syntheticLabBytes = await readFile(syntheticLabFixture);

function syntheticNames() {
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    owner: `Владелец summary ${suffix}`,
    family: `Семья summary ${suffix}`,
    profile: `Профиль summary ${suffix}`,
  };
}

async function registerDemoFamily(page: Page): Promise<string> {
  const names = syntheticNames();
  return createSyntheticFamily(page, names);
}

function factCard(page: Page, index: number): Locator {
  return page.locator(".review-fact").nth(index);
}

async function uploadAndFinishReview(
  page: Page,
  filename: string,
  decision: "confirm" | "correct",
): Promise<void> {
  await page.getByLabel("Синтетический документ", { exact: true }).setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: syntheticLabBytes,
  });
  await page.getByRole("button", { name: "Загрузить исходник" }).click();
  await expect(page.getByRole("heading", { name: "Проверьте извлечённые значения" })).toBeVisible();
  if (decision === "confirm") {
    await factCard(page, 0)
      .getByRole("button", { name: /^Подтвердить / })
      .click();
  } else {
    const first = factCard(page, 0);
    await first.getByRole("button", { name: /^Исправить / }).click();
    await first.getByLabel("Корректное значение").fill("7.1");
    await first.getByRole("button", { name: "Сохранить исправление" }).click();
  }
  await factCard(page, 1)
    .getByRole("button", { name: /^Отклонить / })
    .click();
  await expect(page.getByRole("heading", { name: "Извлечение завершено" })).toBeVisible();
  await page.getByRole("link", { name: "Открыть историю подтверждённых значений" }).click();
}

test("profile summary is a source-first immutable version after final human review", async ({
  page,
}) => {
  const profileUrl = await registerDemoFamily(page);
  const summary = page.getByRole("region", { name: "Сводка для разговора об источниках" });
  await expect(
    summary.getByText("Сводка появится после завершения проверки хотя бы одного документа", {
      exact: false,
    }),
  ).toBeVisible();

  await page.getByLabel("Синтетический документ", { exact: true }).setInputFiles({
    name: `summary-${crypto.randomUUID().slice(0, 8)}.pdf`,
    mimeType: "application/pdf",
    buffer: syntheticLabBytes,
  });
  await page.getByRole("button", { name: "Загрузить исходник" }).click();
  await expect(page).toHaveURL(
    /\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}$/,
  );
  await expect(page.getByRole("heading", { name: "Проверьте извлечённые значения" })).toBeVisible();

  await factCard(page, 0)
    .getByRole("button", { name: /^Подтвердить / })
    .click();
  await factCard(page, 1)
    .getByRole("button", { name: /^Отклонить / })
    .click();
  await expect(page.getByRole("heading", { name: "Извлечение завершено" })).toBeVisible();

  await page.getByRole("link", { name: "Открыть историю подтверждённых значений" }).click();
  await expect(page).toHaveURL(`${profileUrl}#observation-history`);
  await expect(summary.getByLabel("Версия сводки")).toHaveValue("1");
  await expect(summary.getByText("СИНТЕТИЧЕСКИЙ АНАЛИТ A: 7.0 synthetic-unit")).toBeVisible();
  await expect(summary.getByText(/Новый источник в этой версии/)).toBeVisible();
  await expect(summary.getByText("Осторожные следующие шаги", { exact: true })).toBeVisible();
  await expect(
    summary.getByText(/нет диагноза, оценки риска, клинической интерпретации/i),
  ).toBeVisible();
  await expect(
    summary.getByText(/красные флаги этим локальным контуром не оцениваются/i),
  ).toBeVisible();

  await summary.getByRole("link", { name: "Открыть источник" }).click();
  await expect(page).toHaveURL(
    /\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}$/,
  );
  await expect(page.getByRole("link", { name: "Скачать исходный PDF" })).toBeVisible();
});

test("summary selector opens an older immutable source snapshot without deriving a change", async ({
  page,
}) => {
  await registerDemoFamily(page);
  await uploadAndFinishReview(page, `summary-v1-${crypto.randomUUID().slice(0, 8)}.pdf`, "confirm");
  await expect(
    page
      .getByRole("region", { name: "Сводка для разговора об источниках" })
      .getByLabel("Версия сводки"),
  ).toHaveValue("1");

  await uploadAndFinishReview(page, `summary-v2-${crypto.randomUUID().slice(0, 8)}.pdf`, "correct");
  const summary = page.getByRole("region", { name: "Сводка для разговора об источниках" });
  const selector = summary.getByLabel("Версия сводки");
  await expect(selector).toHaveValue("2");
  await expect(
    summary.getByText("СИНТЕТИЧЕСКИЙ АНАЛИТ A: 7.0 synthetic-unit", { exact: true }),
  ).toBeVisible();
  await expect(
    summary.getByText("СИНТЕТИЧЕСКИЙ АНАЛИТ A: 7.1 synthetic-unit", { exact: true }),
  ).toBeVisible();
  await expect(
    summary.getByText("Новых подтверждённых источников: 1", { exact: false }),
  ).toBeVisible();

  await summary
    .getByRole("button", {
      name: "Показать состав источников версии 2 относительно версии 1",
    })
    .click();
  const comparison = summary.getByRole("region", { name: "Состав источников между версиями" });
  await expect(comparison.getByText("Добавлено в версию 2", { exact: true })).toBeVisible();
  await expect(
    comparison.getByText("СИНТЕТИЧЕСКИЙ АНАЛИТ A: 7.1 synthetic-unit", { exact: true }),
  ).toBeVisible();
  await expect(
    comparison.getByText("Все источники предыдущей версии сохранены в этой версии.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(comparison.getByText(/не оценивает изменение здоровья/i)).toBeVisible();

  await selector.selectOption("1");
  await expect(selector).toHaveValue("1");
  await expect(
    summary.getByText("СИНТЕТИЧЕСКИЙ АНАЛИТ A: 7.0 synthetic-unit", { exact: true }),
  ).toBeVisible();
  await expect(
    summary.getByText("СИНТЕТИЧЕСКИЙ АНАЛИТ A: 7.1 synthetic-unit", { exact: true }),
  ).toHaveCount(0);
  await expect(
    summary.getByText("Новых подтверждённых источников: 1", { exact: false }),
  ).toHaveCount(0);
  await expect(
    summary.getByText(/нет диагноза, оценки риска, клинической интерпретации/i),
  ).toBeVisible();
});
