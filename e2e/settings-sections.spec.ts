import { expect, test } from "@playwright/test";
import { registerDemoFamily } from "./support/review";

// Settings live behind the gear in two sections: a family owner opens «Пользователь» and is
// refused «Приложение» (the server section is the administrator's alone).

test("a family owner opens the user section from the gear and is refused the application section", async ({
  page,
}) => {
  await registerDemoFamily(page);
  await page.getByTestId("settings-gear").click();
  await expect(page).toHaveURL(/\/settings\?profile=[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Настройки" })).toBeVisible();
  await expect(page.getByTestId("profile-settings")).toBeVisible();
  await expect(page.getByRole("link", { name: "Приложение" })).toHaveCount(0);
  await page.goto("/settings/app");
  await expect(page.getByRole("heading", { level: 1, name: "Настройки недоступны" })).toBeVisible();
});
