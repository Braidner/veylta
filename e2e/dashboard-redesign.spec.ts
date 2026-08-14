import { expect, test } from "@playwright/test";
import { createSyntheticFamily } from "./support/synthetic-family";

test("desktop dashboard matches the full-width reference composition", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await createSyntheticFamily(page, {
    owner: "Dashboard Owner",
    family: "Dashboard Family",
    profile: "Иван",
  });

  await expect(page.getByRole("heading", { level: 1, name: "Иван" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Поиск по архиву" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Загрузить документ" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Помощники" })).toBeVisible();
  await expect(page.locator("[data-assistant]")).toHaveCount(3);
  await expect(page.locator('[data-assistant="medical_navigator"]')).toContainText(
    "Медицинский навигатор",
  );
  await expect(page.locator('[data-assistant="nutrition"]')).toContainText("недостаточно данных");
  await expect(page.locator('[data-assistant="movement"]')).toContainText("ограничения");
  await expect(page.getByText("Не заменяют специалиста")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Сигналы здоровья" })).toBeVisible();
  await expect(page.getByText("Без общего балла")).toBeVisible();
  await expect(page.getByText("Ждёт проверки")).toBeVisible();
  await expect(page.getByText("Отмечено источником")).toBeVisible();
  await expect(page.getByText("индекс здоровья", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Последний документ" })).toBeVisible();
  await expect(
    page.locator(".dashboard-plan").getByRole("heading", { name: "План заботы" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Добавить источник" })).toHaveAttribute(
    "href",
    "#document-inbox-title",
  );

  const viewportWidth = page.viewportSize()?.width ?? 0;
  const headerBox = await page.locator(".workspace-bar").boundingBox();
  const shellBox = await page.locator(".profile-shell").boundingBox();
  const assistantsBox = await page.locator(".assistant-hub").boundingBox();
  const signalsBox = await page.locator(".health-signals").boundingBox();
  const documentBox = await page.locator(".dashboard-documents").boundingBox();
  const planBox = await page.locator(".dashboard-plan").boundingBox();

  expect(headerBox).not.toBeNull();
  expect(shellBox).not.toBeNull();
  expect(assistantsBox).not.toBeNull();
  expect(signalsBox).not.toBeNull();
  expect(documentBox).not.toBeNull();
  expect(planBox).not.toBeNull();
  expect(headerBox?.x).toBeLessThanOrEqual(1);
  expect(headerBox?.width).toBeGreaterThanOrEqual(viewportWidth - 1);
  expect(shellBox?.x).toBeLessThanOrEqual(1);
  expect(shellBox?.width).toBeGreaterThanOrEqual(viewportWidth - 1);
  expect(signalsBox?.x ?? 0).toBeGreaterThan((assistantsBox?.x ?? 0) + 100);
  expect(documentBox?.y ?? 0).toBeGreaterThan((signalsBox?.y ?? 0) + 100);
  expect(planBox?.x ?? 0).toBeGreaterThan((documentBox?.x ?? 0) + 100);
  expect(planBox?.y).toBe(documentBox?.y);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "Основные разделы профиля" })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Основные разделы профиля" })
      .getByRole("link", { name: "План", exact: true }),
  ).toBeVisible();
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflows).toBe(false);
});
