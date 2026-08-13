import { expect, type Page, test } from "@playwright/test";
import { createSyntheticFamily } from "./support/synthetic-family";

async function openSyntheticProfile(page: Page): Promise<void> {
  const suffix = crypto.randomUUID().slice(0, 8);
  await createSyntheticFamily(page, {
    owner: `Владелец плана ${suffix}`,
    family: `Дом плана ${suffix}`,
    profile: `Профиль плана ${suffix}`,
  });
}

test("an owner plans and completes a dated home-care action without losing it on reload", async ({
  page,
}) => {
  await openSyntheticProfile(page);

  const plan = page.getByRole("region", { name: "План заботы" });
  await expect(plan).toBeVisible();
  await expect(plan.getByText("Не оценка здоровья", { exact: true })).toHaveCount(0);
  for (const heading of ["Анализы", "Специалисты", "Питание", "Активность", "Напоминания"]) {
    await expect(plan.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await expect(
    plan.getByText("Предложения не становятся назначениями автоматически"),
  ).toBeVisible();

  await plan.getByRole("button", { name: "Добавить действие" }).click();
  await plan.getByLabel("Направление").selectOption("reminder");
  await plan.getByLabel("Что вы решили сделать").fill("Повторно обсудить анализ с врачом");
  await plan.getByLabel("Срок").fill("2026-09-15");
  await plan.getByLabel("Контекст для себя").fill("Взять с собой подтверждённый источник.");
  await plan.getByRole("button", { name: "Сохранить в план" }).click();

  const reminder = plan.getByText("Повторно обсудить анализ с врачом").locator("..", {
    hasText: "Запланировано · 2026-09-15",
  });
  await expect(reminder).toContainText("Добавлено человеком · без автоматической рекомендации");

  await page.reload();
  await expect(plan.getByText("Повторно обсудить анализ с врачом")).toBeVisible();
  await plan.getByRole("button", { name: "Отметить выполненным" }).click();
  await expect(plan.getByText("Выполнено", { exact: true })).toBeVisible();

  await page.reload();
  await expect(plan.getByText("Выполнено", { exact: true })).toBeVisible();
  await expect(plan.getByText("Взять с собой подтверждённый источник.")).toBeVisible();
});
