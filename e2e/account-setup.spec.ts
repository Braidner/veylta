import { expect, test } from "@playwright/test";

test("first launch creates the administrator, opens their profile, and later logs back in", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Настройте домашнюю Veylta" }),
  ).toBeVisible();
  await expect(page.getByText("Подключите личную папку")).toHaveCount(0);

  await page.getByLabel("Логин").fill("home-admin");
  await page.getByLabel("Ваше имя").fill("Домашний администратор");
  await page.getByLabel("Пароль", { exact: true }).fill("correct horse battery staple");
  await page.getByLabel("Повторите пароль").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Создать администратора" }).click();

  await expect(page).toHaveURL(/\/families\/[0-9a-f-]+\/profiles\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Домашний администратор" }),
  ).toBeVisible();
  await expect(page.getByText("Администратор системы")).toBeVisible();

  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Войдите в Veylta" })).toBeVisible();

  await page.getByLabel("Логин").fill("HOME-ADMIN");
  await page.getByLabel("Пароль").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Войти" }).click();

  await expect(page).toHaveURL(/\/families\/[0-9a-f-]+\/profiles\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Домашний администратор" }),
  ).toBeVisible();
});
