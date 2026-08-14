import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { uploadSyntheticDocument } from "./support/document-upload";
import { createSyntheticFamily } from "./support/synthetic-family";

const syntheticLabFixture = new URL("../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url);
const syntheticLabBytes = await readFile(syntheticLabFixture);

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
  await page.getByRole("tab", { name: "План", exact: true }).click();

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

test("an owner explicitly sends a confirmed summary to the ChatGPT Codex session and accepts a draft", async ({
  page,
}) => {
  await openSyntheticProfile(page);
  const profileUrl = page.url();
  await uploadSyntheticDocument(page, {
    name: `care-plan-${crypto.randomUUID().slice(0, 8)}.pdf`,
    mimeType: "application/pdf",
    buffer: syntheticLabBytes,
  });
  await expect(page.getByRole("heading", { name: "Проверьте извлечённые значения" })).toBeVisible();
  const facts = page.locator(".review-fact");
  await facts
    .first()
    .getByRole("button", { name: /^Подтвердить / })
    .click();
  await facts
    .nth(1)
    .getByRole("button", { name: /^Отклонить / })
    .click();
  await expect(page.getByRole("heading", { name: "Извлечение завершено" })).toBeVisible();

  await page.goto(profileUrl);
  await page.getByRole("tab", { name: "План", exact: true }).click();
  const plan = page.getByRole("region", { name: "План заботы" });
  await plan.getByRole("button", { name: "Предложения Codex" }).click();
  const disclosure = plan.getByRole("region", {
    name: "Передать подтверждённую сводку в Codex?",
  });
  await expect(disclosure.getByText("ChatGPT подписка", { exact: false })).toBeVisible();
  await expect(
    disclosure.getByText(/названия, значения, единицы, даты, код показателя, лаборатория/),
  ).toBeVisible();
  await expect(
    disclosure.getByText(/PDF, имена файлов, фрагменты, идентификаторы записей/),
  ).toBeVisible();
  await disclosure.getByRole("button", { name: "Да, сформировать черновики" }).click();

  const proposal = plan.locator("li", { hasText: /Обсудить контроль:/ });
  await expect(proposal.getByText("Предложение · ждёт решения")).toBeVisible();
  await proposal.getByText("Почему это предложено").click();
  await expect(proposal.getByText(/Модель gpt-5\.6-sol/)).toBeVisible();
  await proposal.getByRole("button", { name: "Принять" }).click();
  await expect(proposal.getByText("Принято без срока")).toBeVisible();

  await page.reload();
  await expect(plan.getByText(/Обсудить контроль:/)).toBeVisible();
  await expect(plan.getByText("Принято без срока")).toBeVisible();
});
