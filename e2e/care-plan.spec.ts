import { readFile } from "node:fs/promises";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { uploadSyntheticDocument } from "./support/document-upload";
import { acceptSyntheticInvitation, createSyntheticFamily } from "./support/synthetic-family";

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

/** Files one accepted regimen action into the plan from the dossier tab. */
async function addRegimenItem(page: Page, title: string): Promise<void> {
  await page.getByRole("tab", { name: "Досье", exact: true }).click();
  const plan = page.getByRole("region", { name: "План заботы" });
  await plan.getByRole("button", { name: "Добавить действие" }).click();
  await plan.getByLabel("Направление").selectOption("activity");
  await plan.getByLabel("Что вы решили сделать").fill(title);
  await plan.getByRole("button", { name: "Сохранить в план" }).click();
  await expect(plan.getByText(title)).toBeVisible();
}

test("an owner plans and completes a dated home-care action without losing it on reload", async ({
  page,
}) => {
  await openSyntheticProfile(page);
  await page.getByRole("tab", { name: "Досье", exact: true }).click();

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
  await expect(page.getByRole("heading", { name: "Результаты исследования" })).toBeVisible();
  const facts = page.locator(".document-result-card--selectable");
  await facts.first().click();
  await page.getByRole("button", { name: "Подтвердить результат" }).click();
  await facts.nth(1).click();
  await page.getByRole("button", { name: "Отклонить результат" }).click();
  await expect(page.getByRole("heading", { name: "Извлечение завершено" })).toBeVisible();

  await page.goto(profileUrl);
  await page.getByRole("tab", { name: "Досье", exact: true }).click();
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

  // The overview counts what still waits for a decision without naming the room that proposed it.
  await page.getByRole("tab", { name: "Обзор", exact: true }).click();
  await expect(
    page.locator(".dashboard-plan__proposals").getByText(/предложени\S* жд\S* вашего решения/),
  ).toBeVisible();
});

test("an accepted regimen item is marked from the overview and the mark survives a reload", async ({
  page,
}) => {
  await openSyntheticProfile(page);
  // A record with no regimen has no «Сегодня» at all — not an empty shell.
  await expect(page.locator(".dashboard-today")).toHaveCount(0);

  await addRegimenItem(page, "Быстрая ходьба 30 минут");

  await page.getByRole("tab", { name: "Обзор", exact: true }).click();
  const overviewPlan = page.locator(".dashboard-plan");
  await expect(overviewPlan.getByRole("heading", { name: "Сегодня" })).toBeVisible();
  const today = overviewPlan.locator(".dashboard-today__item", {
    hasText: "Быстрая ходьба 30 минут",
  });
  await expect(today).toContainText("Активность");
  await expect(today).toContainText("сегодня: без отметки");
  // The rhythm is a week of the plan's own diary, each day readable without colour.
  const rhythm = today.getByRole("list", { name: "Ритм за неделю: Быстрая ходьба 30 минут" });
  await expect(rhythm.getByRole("listitem")).toHaveCount(7);
  // «Сегодня» already names it, so the scheduled list below does not repeat it.
  await expect(overviewPlan.locator(".dashboard-plan__items li")).toHaveCount(0);

  const done = today.getByRole("button", { name: "Сделал: Быстрая ходьба 30 минут" });
  await done.click();
  await expect(today).toContainText("сегодня: сделано");
  await expect(done).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  const marked = page.locator(".dashboard-today__item", { hasText: "Быстрая ходьба 30 минут" });
  await expect(marked).toContainText("сегодня: сделано");
  await expect(
    marked.getByRole("button", { name: "Сделал: Быстрая ходьба 30 минут" }),
  ).toHaveAttribute("aria-pressed", "true");
  // The diary is the person's to correct: the same day again replaces the mark.
  await marked.getByRole("button", { name: "Пропустил: Быстрая ходьба 30 минут" }).click();
  await expect(marked).toContainText("сегодня: пропущено");
});

test("a read-only viewer reads the rhythm and the mark, and is offered no way to write one", async ({
  browser,
}: {
  browser: Browser;
}) => {
  const ownerContext = await browser.newContext();
  const readerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const readerPage = await readerContext.newPage();

  try {
    await openSyntheticProfile(ownerPage);
    const profileUrl = ownerPage.url();
    await addRegimenItem(ownerPage, "Быстрая ходьба 30 минут");
    await ownerPage.getByRole("tab", { name: "Обзор", exact: true }).click();
    await ownerPage.getByRole("button", { name: "Сделал: Быстрая ходьба 30 минут" }).click();
    await expect(ownerPage.locator(".dashboard-today__item")).toContainText("сегодня: сделано");

    await ownerPage.getByTestId("settings-gear").click();
    const invitation = ownerPage.getByRole("region", { name: "Пригласить участника" });
    await invitation.getByRole("button", { name: "Создать код для взрослого" }).click();
    const code = await invitation.locator("code").textContent();
    await acceptSyntheticInvitation(readerPage, {
      code: code ?? "",
      displayName: `Читатель ${crypto.randomUUID().slice(0, 8)}`,
      profileName: `Личный профиль ${crypto.randomUUID().slice(0, 8)}`,
    });

    await ownerPage.reload();
    const consent = ownerPage.getByRole("region", { name: "Доступ к этому профилю" });
    await consent.getByRole("button", { name: "Разрешить чтение" }).click();
    await expect(consent.getByText("Только чтение", { exact: true })).toBeVisible();

    await readerPage.goto(profileUrl);
    const shared = readerPage.locator(".dashboard-today__item");
    await expect(shared).toContainText("Быстрая ходьба 30 минут");
    await expect(shared).toContainText("сегодня: сделано");
    await expect(
      shared.getByRole("list", { name: "Ритм за неделю: Быстрая ходьба 30 минут" }),
    ).toBeVisible();
    await expect(readerPage.getByRole("button", { name: /^Сделал: / })).toHaveCount(0);
    await expect(readerPage.getByRole("button", { name: /^Пропустил: / })).toHaveCount(0);
  } finally {
    await ownerContext.close();
    await readerContext.close();
  }
});
