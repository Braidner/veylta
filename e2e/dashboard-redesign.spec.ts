import { expect, test } from "@playwright/test";
import { createSyntheticFamily } from "./support/synthetic-family";

test("profile dashboard leads with safe assistants and factual health signals", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await createSyntheticFamily(page, {
    owner: "Dashboard Owner",
    family: "Dashboard Family",
    profile: "Иван",
  });

  await expect(page.getByRole("heading", { level: 1, name: "Иван" })).toBeVisible();
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
  await expect(page.getByRole("link", { name: "Добавить источник" })).toHaveAttribute(
    "href",
    "#document-inbox-title",
  );

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
