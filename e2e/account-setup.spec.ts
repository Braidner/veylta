import { expect, test } from "@playwright/test";

test("first launch creates the administrator, opens their profile, and later logs back in", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Настройте домашнюю Veylta" }),
  ).toBeVisible();
  await expect(page.getByText("Подключите личную папку")).toHaveCount(0);
  await expect(page.getByText(/3–32 латинских символа/)).toBeVisible();
  await expect(page.getByText(/Не менее 12 символов/)).toBeVisible();

  await page.getByLabel("Логин").fill("админ");
  await page.getByLabel("Ваше имя").fill("Домашний администратор");
  await page.getByLabel("Пароль", { exact: true }).fill("correct horse battery staple");
  await page.getByLabel("Повторите пароль").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Создать администратора" }).click();
  await expect(page.locator(".form-error[role='alert']")).toHaveText(
    "Логин: 3–32 латинских символа, цифры, точка, дефис или подчёркивание.",
  );

  await page.getByLabel("Логин").fill("home-admin");
  await page.getByRole("button", { name: "Создать администратора" }).click();

  await expect(page).toHaveURL(/\/families\/[0-9a-f-]+\/profiles\/[0-9a-f-]+$/);
  const administratorProfileUrl = page.url();
  await expect(
    page.getByRole("heading", { level: 1, name: "Домашний администратор" }),
  ).toBeVisible();
  await expect(page.getByText("Администратор системы")).toBeVisible();

  await expect(page.getByRole("tab", { name: "Настройки" })).toHaveCount(0);
  await page.getByTestId("settings-gear").click();
  // Opened from a profile, settings carries that profile so family management starts on it.
  await expect(page).toHaveURL(/\/settings\?profile=[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Настройки" })).toBeVisible();
  await expect(page.getByTestId("profile-settings")).toBeVisible();
  await page.getByRole("link", { name: "Приложение" }).click();
  await expect(page).toHaveURL(/\/settings\/app\?profile=[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Настройки сервера" })).toBeVisible();
  await expect(page.getByText("API и база данных готовы")).toBeVisible();
  await expect(page.locator(".workspace-bar--profile")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Локальный агент без API-ключа" })).toBeVisible();
  await expect(page.getByText("отдельной оплаты за API-токены нет")).toBeVisible();
  await expect(page.locator('select[name="modelId"]')).toHaveValue("gpt-5.6-sol");
  await expect(page.getByLabel("Рассуждения в диалогах и плане")).toHaveValue("medium");
  // Extraction runs at its own, lower effort by default; the assistants at a higher one.
  await expect(page.getByLabel("Рассуждения при разборе документов")).toHaveValue("low");
  await expect(page.getByLabel("Рассуждения ассистентов")).toHaveValue("high");
  await expect(page.getByText("Осталось 65%")).toBeVisible();
  await page.locator('select[name="modelId"]').selectOption("gpt-5.6-luna");
  await expect(page.locator('select[name="modelId"]')).toHaveValue("gpt-5.6-luna");
  await page.getByLabel("Рассуждения в диалогах и плане").selectOption("high");
  await expect(page.getByLabel("Рассуждения в диалогах и плане")).toHaveValue("high");
  await page.getByLabel("Рассуждения ассистентов").selectOption("xhigh");
  await page.getByText("Fast · 1,5× быстрее").click();
  await expect(page.getByRole("radio", { name: /Fast/ })).toBeChecked();
  await expect(page.getByText("Новые задания: GPT-5.6 Luna · Высокий · Fast")).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/v1/settings/codex/preferences") &&
        response.request().method() === "PUT" &&
        response.status() === 200,
    ),
    page.getByRole("button", { name: "Сохранить профиль" }).click(),
  ]);
  await expect(page.locator(".settings-notice[role='status']")).toContainText(
    "Профиль Codex сохранён",
  );
  await expect(
    page.getByText("GPT-5.6 Luna · Высокий · разбор: Низкий · ассистенты: Очень высокий", {
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator('select[name="modelId"]')).toHaveValue("gpt-5.6-luna");
  await expect(page.getByLabel("Рассуждения в диалогах и плане")).toHaveValue("high");
  await expect(page.getByLabel("Рассуждения ассистентов")).toHaveValue("xhigh");
  await expect(page.getByRole("radio", { name: /Fast/ })).toBeChecked();
  await page.locator('select[name="modelId"]').selectOption("gpt-5.6-sol");
  await expect(page.locator('select[name="modelId"]')).toHaveValue("gpt-5.6-sol");
  await page.getByLabel("Рассуждения в диалогах и плане").selectOption("medium");
  await page.getByText("Стандартный").click();
  await expect(page.getByText("Новые задания: GPT-5.6 Sol · Средний · Стандартный")).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/v1/settings/codex/preferences") &&
        response.request().method() === "PUT" &&
        response.status() === 200,
    ),
    page.getByRole("button", { name: "Сохранить профиль" }).click(),
  ]);
  await expect(page.locator(".settings-notice[role='status']")).toContainText(
    "Профиль Codex сохранён",
  );
  await expect(
    page.getByText("GPT-5.6 Sol · Средний · разбор: Низкий · ассистенты: Очень высокий", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Учётные записи" })).toContainText(
    "Домашний администратор",
  );

  await page.getByLabel("Имя человека").fill("Пользователь семьи");
  await page.getByLabel("Логин").fill("family-user");
  await page.getByRole("combobox", { name: "Роль", exact: true }).selectOption("user");
  await page.getByLabel("Временный пароль", { exact: true }).fill("another correct local password");
  await page.getByLabel("Повторите временный пароль").fill("another correct local password");
  await page.getByRole("button", { name: "Создать учётную запись" }).click();
  await expect(page.locator(".settings-notice[role='status']")).toContainText("family-user");
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

  await page.goto("/settings/app");
  await expect(page.getByRole("heading", { level: 1, name: "Настройки недоступны" })).toBeVisible();

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
