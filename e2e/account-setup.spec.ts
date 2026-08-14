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
  const administratorProfileUrl = page.url();
  await expect(
    page.getByRole("heading", { level: 1, name: "Домашний администратор" }),
  ).toBeVisible();
  await expect(page.getByText("Администратор системы")).toBeVisible();

  await page.getByRole("link", { name: "Настройки" }).click();
  await expect(page).toHaveURL("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Настройки сервера" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Локальный агент без API-ключа" })).toBeVisible();
  await expect(page.getByText("отдельной оплаты за API-токены нет")).toBeVisible();
  await expect(page.getByRole("list", { name: "Учётные записи" })).toContainText(
    "Домашний администратор",
  );

  await page.getByLabel("Имя человека").fill("Пользователь семьи");
  await page.getByLabel("Логин").fill("family-user");
  await page.getByRole("combobox", { name: "Роль", exact: true }).selectOption("user");
  await page.getByLabel("Временный пароль", { exact: true }).fill("another correct local password");
  await page.getByLabel("Повторите временный пароль").fill("another correct local password");
  await page.getByRole("button", { name: "Создать учётную запись" }).click();
  await expect(page.getByRole("status")).toContainText("family-user");
  await expect(page.getByRole("list", { name: "Учётные записи" })).toContainText(
    "Пользователь семьи",
  );

  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Войдите в Veylta" })).toBeVisible();

  await page.getByLabel("Логин").fill("family-user");
  await page.getByLabel("Пароль").fill("another correct local password");
  await page.getByRole("button", { name: "Войти" }).click();

  await expect(page).toHaveURL(/\/families\/[0-9a-f-]+\/profiles\/[0-9a-f-]+$/);
  const userProfileUrl = page.url();
  await expect(page.getByRole("heading", { level: 1, name: "Пользователь семьи" })).toBeVisible();
  await expect(page.getByText("Пользователь системы")).toBeVisible();
  await expect(page.getByRole("link", { name: "Настройки" })).toHaveCount(0);

  await page.goto(administratorProfileUrl);
  await expect(page.getByRole("heading", { level: 1, name: "Профиль недоступен" })).toBeVisible();
  await expect(page.getByText("Домашний администратор")).toHaveCount(0);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Настройки недоступны" })).toBeVisible();
  await expect(page.getByText("Домашний администратор")).toHaveCount(0);
  await expect(page.getByText("Точка хранения")).toHaveCount(0);

  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Войдите в Veylta" })).toBeVisible();

  await page.getByLabel("Логин").fill("HOME-ADMIN");
  await page.getByLabel("Пароль").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Войти" }).click();

  await expect(page).toHaveURL(/\/families\/[0-9a-f-]+\/profiles\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Домашний администратор" }),
  ).toBeVisible();

  await page.goto(userProfileUrl);
  await expect(page.getByRole("heading", { level: 1, name: "Пользователь семьи" })).toBeVisible();
  await expect(page.getByText("Администратор системы")).toBeVisible();
});
