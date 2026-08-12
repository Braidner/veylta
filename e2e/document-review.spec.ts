import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

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
  await page.goto("/");
  await page.getByLabel("Имя владельца").fill(names.owner);
  await page.getByLabel("Название семьи").fill(names.family);
  await page.getByLabel("Имя профиля").fill(names.profile);
  await page.getByRole("button", { name: "Создать пространство" }).click();
  await expect(page).toHaveURL(/\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}$/);
}

async function openReview(page: Page): Promise<void> {
  await registerDemoFamily(page);
  await page.getByLabel("Синтетический PDF", { exact: true }).setInputFiles({
    name: `review-${crypto.randomUUID().slice(0, 8)}.pdf`,
    mimeType: "application/pdf",
    buffer: syntheticLabBytes,
  });
  await page.getByRole("button", { name: "Загрузить PDF" }).click();
  await expect(page).toHaveURL(
    /\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}$/,
  );
  await expect(page.getByRole("heading", { name: "Проверьте извлечённые значения" })).toBeVisible();
}

function factCard(page: Page, factKey: string): Locator {
  const cards = page.locator(".review-fact");
  return factKey === "synthetic-analyte-a" ? cards.first() : cards.nth(1);
}

function factStatus(fact: Locator): Locator {
  return fact.locator(".review-fact__state strong");
}

test("review presents source evidence before an explicit confirmation and keeps it after reload", async ({
  page,
}) => {
  await openReview(page);

  const firstFact = factCard(page, "synthetic-analyte-a");
  await expect(firstFact).toHaveCount(1);
  await expect(firstFact.locator("h4")).toHaveText(/\S+/);
  await expect(firstFact.getByText("Источник", { exact: true })).toBeVisible();
  await expect(firstFact.getByText("Предложенные поля", { exact: true })).toBeVisible();
  await expect(firstFact.getByText("7.0 synthetic-unit", { exact: true })).toBeVisible();
  await expect(firstFact.getByText("Страница 1")).toBeVisible();
  await expect(firstFact.getByText("Неоднозначная единица")).toBeVisible();
  await expect(firstFact.getByText(/Уверенность извлечения: 60\s?%/)).toBeVisible();
  await expect(firstFact.getByText("FACT|synthetic-analyte-a")).toBeVisible();
  await expect(factStatus(firstFact)).toHaveText("Не подтверждено");

  await firstFact.getByRole("button", { name: /^Подтвердить / }).click();
  await expect(factStatus(firstFact)).toHaveText("Подтверждено пользователем");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Проверьте извлечённые значения" })).toBeVisible();
  await expect(factStatus(factCard(page, "synthetic-analyte-a"))).toHaveText(
    "Подтверждено пользователем",
  );
  await expect(
    factCard(page, "synthetic-analyte-a").getByRole("button", { name: /^Подтвердить / }),
  ).toHaveCount(0);
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
        contractVersion: "document/v3",
        review: {
          id: "00000000-0000-4000-8000-000000000001",
          factId: "00000000-0000-4000-8000-000000000002",
          factVersion: 1,
          outcome: "confirmed",
          decidedAt: "2026-08-12T12:00:00.000Z",
          observationId: "00000000-0000-4000-8000-000000000003",
        },
      }),
    });
  });

  const confirm = factCard(page, "synthetic-analyte-a").getByRole("button", {
    name: /^Подтвердить /,
  });
  await confirm.click();
  await expect(
    page.getByText("Не удалось сохранить решение. Исходное извлечение не изменилось."),
  ).toBeVisible();
  await confirm.click();

  await expect.poll(() => idempotencyKeys.length).toBe(2);
  expect(idempotencyKeys[0]).toEqual(idempotencyKeys[1]);
});

test("a correction preserves the displayed source while a second fact can be explicitly rejected", async ({
  page,
}) => {
  await openReview(page);

  const firstFact = factCard(page, "synthetic-analyte-a");
  const secondFact = factCard(page, "synthetic-analyte-b");
  await expect(firstFact).toHaveCount(1);
  await expect(secondFact).toHaveCount(1);
  await firstFact.getByRole("button", { name: /^Исправить / }).click();
  await expect(firstFact.getByRole("form", { name: /^Исправление:/ })).toBeVisible();
  await firstFact.getByLabel("Корректное значение").fill("7.1");
  await firstFact.getByRole("button", { name: "Сохранить исправление" }).click();
  await expect(firstFact.getByText("Исправлено и подтверждено", { exact: true })).toBeVisible();
  await expect(firstFact.getByText("7.0 synthetic-unit", { exact: true })).toBeVisible();
  const corrected = firstFact.getByRole("region", { name: /Подтверждённое исправление/ });
  await expect(corrected.getByText("Название", { exact: true })).toBeVisible();
  await expect(corrected.getByText("Значение", { exact: true })).toBeVisible();
  await expect(corrected.getByText("Единица", { exact: true })).toBeVisible();
  await expect(corrected.getByText("7.1 synthetic-unit", { exact: true })).toBeVisible();

  await secondFact.getByRole("button", { name: /^Отклонить / }).click();
  await expect(factStatus(secondFact)).toHaveText("Отклонено пользователем");
  await expect(page.getByRole("heading", { name: "Извлечение завершено" })).toBeVisible();

  await page.reload();
  const reloadedFirstFact = factCard(page, "synthetic-analyte-a");
  await expect(reloadedFirstFact.getByText("7.0 synthetic-unit", { exact: true })).toBeVisible();
  const reloadedCorrection = reloadedFirstFact.getByRole("region", {
    name: /Подтверждённое исправление/,
  });
  await expect(reloadedCorrection.getByText("7.1 synthetic-unit", { exact: true })).toBeVisible();
  await expect(factStatus(reloadedFirstFact)).toHaveText("Подтверждено пользователем");
  await expect(factStatus(factCard(page, "synthetic-analyte-b"))).toHaveText(
    "Отклонено пользователем",
  );
});
