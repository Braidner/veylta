import { expect, test } from "@playwright/test";
import { createSyntheticFamily } from "./support/synthetic-family";

test("a person records their medical profile and the assistants' readiness follows it", async ({
  page,
}) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  await createSyntheticFamily(page, {
    owner: `Владелец profile ${suffix}`,
    family: `Семья profile ${suffix}`,
    profile: `Профиль profile ${suffix}`,
  });
  await page
    .getByRole("tablist", { name: "Основные разделы профиля" })
    .getByRole("tab", { name: "План", exact: true })
    .click();
  const section = page.getByTestId("medical-profile");
  await expect(section.getByRole("heading", { name: "Медицинский профиль" })).toBeVisible();
  await expect(section.getByRole("status")).toContainText("пол и год рождения");

  const basics = section.getByRole("region", { name: "Основное" });
  await basics.getByRole("button", { name: "Добавить" }).click();
  await basics.getByLabel("Что записать").selectOption("sex");
  await basics.getByLabel("Значение").selectOption("female");
  await basics.getByRole("button", { name: "Сохранить" }).click();
  await expect(basics.getByText("Женский")).toBeVisible();
  await expect(section.getByRole("status")).toContainText("год рождения");
  await expect(section.getByRole("status")).not.toContainText("пол и");

  await basics.getByRole("button", { name: "Добавить" }).click();
  await basics.getByLabel("Что записать").selectOption("birth_year");
  await basics.getByLabel("Значение").fill("1992");
  await basics.getByRole("button", { name: "Сохранить" }).click();
  await expect(basics.getByText("1992")).toBeVisible();
  await expect(section.getByRole("status")).toHaveCount(0);

  const health = section.getByRole("region", { name: "Состояния и лекарства" });
  await health.getByRole("button", { name: "Добавить" }).click();
  await health.getByLabel("Что записать").selectOption("medication");
  await health.getByLabel("Значение").fill("Синтетический препарат A, утром");
  await health.getByLabel("Дата (необязательно)").fill("2026-08-01");
  await health.getByRole("button", { name: "Сохранить" }).click();
  await expect(health.getByText("Синтетический препарат A, утром")).toBeVisible();
  await expect(health.getByText("1 августа 2026 г.")).toBeVisible();

  await page.reload();
  const reloaded = page.getByTestId("medical-profile");
  await expect(reloaded.getByText("Женский")).toBeVisible();
  await expect(reloaded.getByText("Синтетический препарат A, утром")).toBeVisible();

  const medicationRow = reloaded
    .getByRole("listitem")
    .filter({ hasText: "Синтетический препарат A" });
  await medicationRow.getByRole("button", { name: "Убрать" }).click();
  await expect(reloaded.getByText("Синтетический препарат A, утром")).toHaveCount(0);
});
