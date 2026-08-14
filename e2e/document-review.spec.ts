import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { distinctSyntheticDocument, uploadSyntheticDocument } from "./support/document-upload";
import { createSyntheticFamily } from "./support/synthetic-family";

const syntheticLabFixture = new URL("../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url);
const syntheticLabBytes = await readFile(syntheticLabFixture);

function syntheticNames() {
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    owner: `Владелец review ${suffix}`,
    family: `Семья review ${suffix}`,
    profile: `Профиль review ${suffix}`,
  };
}

async function registerDemoFamily(page: Page) {
  const names = syntheticNames();
  await createSyntheticFamily(page, names);
  return names;
}

async function openReview(page: Page) {
  const names = await registerDemoFamily(page);
  const filename = `review-${crypto.randomUUID().slice(0, 8)}.pdf`;
  await uploadSyntheticDocument(page, {
    name: filename,
    mimeType: "application/pdf",
    buffer: distinctSyntheticDocument(syntheticLabBytes, filename),
  });
  await expect(page).toHaveURL(
    /\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}$/,
  );
  await expect(page.getByRole("heading", { name: "Результаты исследования" })).toBeVisible();
  return names;
}

function resultCard(page: Page, factKey: string): Locator {
  return page.getByTestId(`document-result-card-${factKey}`);
}

function reviewWorkspace(page: Page): Locator {
  return page.getByTestId("document-review-workspace");
}

test("selecting a result keeps its evidence in one contextual review rail", async ({ page }) => {
  await openReview(page);

  const firstResult = resultCard(page, "synthetic-analyte-a");
  const secondResult = resultCard(page, "synthetic-analyte-b");
  const workspace = reviewWorkspace(page);
  const source = workspace.getByTestId("document-review-source");
  const resultsPanel = workspace.locator(".document-review-workspace__body");
  const hero = page.getByTestId("document-hero");

  await expect(firstResult).toHaveAttribute("aria-pressed", "true");
  await expect(secondResult).toHaveAttribute("aria-pressed", "false");
  await expect(source.getByText("Источник результата", { exact: true })).toBeVisible();
  await expect(source.getByText("7.0 synthetic-unit", { exact: true })).toBeVisible();
  await expect(source.getByText("Страница 1", { exact: true })).toBeVisible();
  await expect(source.getByText("FACT|synthetic-analyte-a")).toBeVisible();
  await expect(source.getByText("Уверенность извлечения", { exact: true })).toBeVisible();
  await expect(source.getByText(/60\s*%/)).toBeVisible();
  await expect(source.getByText("Неоднозначная единица", { exact: true })).toBeVisible();
  await expect(source.getByText("Диапазон в документе", { exact: true })).toBeVisible();
  await expect(source.getByText("5.0–8.0 synthetic-unit", { exact: true })).toBeVisible();
  expect(await source.evaluate((element) => getComputedStyle(element).position)).toBe("static");
  const [heroBox, sourceBox, resultsPanelBox, firstResultBox] = await Promise.all([
    hero.boundingBox(),
    source.boundingBox(),
    resultsPanel.boundingBox(),
    firstResult.boundingBox(),
  ]);
  expect(heroBox).not.toBeNull();
  expect(sourceBox).not.toBeNull();
  expect(resultsPanelBox).not.toBeNull();
  expect(firstResultBox).not.toBeNull();
  expect(Math.abs((resultsPanelBox?.y ?? 0) - (sourceBox?.y ?? 0))).toBeLessThanOrEqual(2);
  expect(firstResultBox?.y ?? 0).toBeGreaterThan((heroBox?.y ?? 0) + (heroBox?.height ?? 0));
  expect(sourceBox?.y ?? 0).toBeGreaterThan((heroBox?.y ?? 0) + (heroBox?.height ?? 0));

  await secondResult.click();
  await expect(secondResult).toHaveAttribute("aria-pressed", "true");
  await expect(firstResult).toHaveAttribute("aria-pressed", "false");
  await expect(source.getByText("FACT|synthetic-analyte-b")).toBeVisible();
});

test("confirming one selected result selects the next pending result and writes a durable decision journal", async ({
  page,
}) => {
  const names = await openReview(page);
  const firstResult = resultCard(page, "synthetic-analyte-a");
  const secondResult = resultCard(page, "synthetic-analyte-b");
  const workspace = reviewWorkspace(page);

  await expect(firstResult).toHaveAttribute("aria-pressed", "true");
  await workspace.getByRole("button", { name: "Подтвердить результат" }).click();

  await expect(secondResult).toHaveAttribute("aria-pressed", "true");
  await expect(workspace.getByTestId("document-review-journal")).toHaveCount(0);
  await expect(workspace.locator(".document-review-workspace__notice")).toHaveText(
    "Подтверждено пользователем",
  );
  await firstResult.click();
  const journal = workspace.getByTestId("document-review-journal");
  await expect(journal.getByText("Подтверждено пользователем", { exact: true })).toBeVisible();
  await expect(journal.getByText(names.owner, { exact: true })).toBeVisible();
  await expect(journal.locator("time")).toHaveAttribute("datetime", /2026-08-14T/);
  await expect(journal.getByText("Идентификатор разбора", { exact: true })).toBeVisible();
  await expect(journal.getByText("Версия экстрактора", { exact: true })).toBeVisible();

  await page.reload();
  await resultCard(page, "synthetic-analyte-a").click();
  const reloadedJournal = reviewWorkspace(page).getByTestId("document-review-journal");
  await expect(reloadedJournal.getByText(names.owner, { exact: true })).toBeVisible();
  await expect(reloadedJournal.locator("time")).toHaveAttribute("datetime", /2026-08-14T/);
});

test("bulk confirmation leaves warning-bearing results for an individual decision", async ({
  page,
}) => {
  await openReview(page);
  const workspace = reviewWorkspace(page);

  const confirmAll = workspace.getByRole("button", { name: "Подтвердить без замечаний 1" });
  await expect(confirmAll).toBeVisible();
  await confirmAll.click();

  await expect(workspace.getByText("Подтверждено 1 значение", { exact: true })).toBeVisible();
  await expect(confirmAll).toHaveCount(0);
  await expect(resultCard(page, "synthetic-analyte-a")).toContainText("Нужна отдельная проверка");
  await expect(resultCard(page, "synthetic-analyte-b")).toContainText("Подтверждено");
});

test("a retried review command reuses its idempotency key after a transient browser failure", async ({
  page,
}) => {
  await openReview(page);

  const idempotencyKeys: string[] = [];
  let reviewAttempts = 0;
  await page.route("**/health-api/**/facts/*/review", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }

    const key = request.headers()["idempotency-key"];
    if (key !== undefined) idempotencyKeys.push(key);
    reviewAttempts += 1;
    if (reviewAttempts === 1) {
      await route.abort("failed");
      return;
    }

    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        contractVersion: "document/v5",
        review: {
          id: "00000000-0000-4000-8000-000000000001",
          factId: "00000000-0000-4000-8000-000000000002",
          factVersion: 1,
          outcome: "confirmed",
          decidedAt: "2026-08-12T12:00:00.000Z",
          observationId: "00000000-0000-4000-8000-000000000003",
          decidedBy: {
            id: "00000000-0000-4000-8000-000000000004",
            displayName: "Владелец review",
          },
        },
      }),
    });
  });

  const confirm = reviewWorkspace(page).getByRole("button", { name: "Подтвердить результат" });
  await confirm.click();
  await expect(
    page.getByText("Не удалось сохранить решение. Исходное извлечение не изменилось."),
  ).toBeVisible();
  await confirm.click();

  await expect.poll(() => idempotencyKeys.length).toBe(2);
  expect(idempotencyKeys[0]).toEqual(idempotencyKeys[1]);
});

test("inline correction preserves the source and the selected result can be rejected", async ({
  page,
}) => {
  await openReview(page);
  const workspace = reviewWorkspace(page);
  const source = workspace.getByTestId("document-review-source");

  await workspace.getByRole("button", { name: "Исправить результат" }).click();
  const correction = workspace.getByRole("form", { name: "Исправление результата" });
  await expect(correction).toBeVisible();
  await correction.getByLabel("Корректное значение").fill("7.1");
  await correction.getByRole("button", { name: "Сохранить исправление" }).click();
  await resultCard(page, "synthetic-analyte-a").click();
  await expect(workspace.getByText("Исправлено и подтверждено", { exact: true })).toBeVisible();
  await expect(source.getByText("7.0 synthetic-unit", { exact: true })).toBeVisible();
  const corrected = workspace.getByRole("region", { name: "Подтверждённое исправление" });
  await expect(corrected.getByText("Название", { exact: true })).toBeVisible();
  await expect(corrected.getByText("Значение", { exact: true })).toBeVisible();
  await expect(corrected.getByText("Единица", { exact: true })).toBeVisible();
  await expect(corrected.getByText("7.1 synthetic-unit", { exact: true })).toBeVisible();

  await resultCard(page, "synthetic-analyte-b").click();
  await workspace.getByRole("button", { name: "Отклонить результат" }).click();
  await expect(
    workspace.locator(".review-fact__notice").filter({ hasText: "Отклонено пользователем" }),
  ).toBeVisible();
});

test("missing critical fields can be handed to Codex and a mapped indicator shows its history", async ({
  page,
}) => {
  await openReview(page);
  await page.route("**/health-api/**/documents/*/facts", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      items: Array<{ proposedSampledAt: string | null; proposedLaboratory: string | null }>;
    };
    await route.fulfill({
      response,
      json: {
        ...body,
        items: body.items.map((item) => ({
          ...item,
          proposedSampledAt: null,
          proposedLaboratory: null,
        })),
      },
    });
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Результаты исследования" })).toBeVisible();
  const workspace = reviewWorkspace(page);
  const completeness = workspace.getByTestId("document-review-completeness");
  await expect(completeness.getByText("Дата биоматериала", { exact: true })).toBeVisible();
  await expect(completeness.getByText("Лаборатория", { exact: true })).toBeVisible();

  await completeness.getByRole("button", { name: "Уточнить у Codex" }).click();
  await expect(page.getByLabel("Сообщение для Codex")).toHaveValue(
    /лабораторию.*дату биоматериала.*код показателя/i,
  );

  await workspace.getByRole("button", { name: "Подтвердить результат" }).click();
  await resultCard(page, "synthetic-analyte-a").click();
  const history = workspace.getByTestId("document-review-history");
  await expect(history.getByRole("heading", { name: "История показателя" })).toBeVisible();
  await expect(history.getByText("Синтетический аналит A", { exact: true })).toBeVisible();
  await expect(history.getByText("7.0 synthetic-unit", { exact: true })).toBeVisible();
  const fullHistory = history.getByRole("link", { name: "Открыть всю историю" });
  await expect(fullHistory).toHaveAttribute("href", /canonicalCode=synthetic-analyte-a/);
  await fullHistory.click();
  await expect(page).toHaveURL(/tab=history&canonicalCode=synthetic-analyte-a/);
  await expect(
    page.getByRole("heading", { name: "История подтверждённых значений" }),
  ).toBeVisible();
  await expect(
    page.getByRole("table").getByText("synthetic-analyte-a", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("table").getByText("synthetic-analyte-b", { exact: true }),
  ).toHaveCount(0);
});
