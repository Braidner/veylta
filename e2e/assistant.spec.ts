import { expect, test } from "@playwright/test";
import { recordBasics } from "./support/dossier";
import { openReview, reviewWorkspace } from "./support/review";

// The physician assistant end to end against the fake codex: nothing leaves before the egress
// gate is confirmed, an unready profile yields only «missing» blocks, a ready one yields typed
// blocks bound to the confirmed value's source, and a referral lands in the clinician lane.

test("the physician assistant gates egress, binds every block to a source and refers to a clinician", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openReview(page);
  const workspace = reviewWorkspace(page);
  await workspace.getByRole("button", { name: "Подтвердить результат" }).click();
  await expect(workspace.locator(".document-review-workspace__notice")).toHaveText(
    "Подтверждено пользователем",
  );

  const profileUrl = page.url().replace(/\/documents\/[0-9a-f-]{36}$/, "");
  await page.goto(profileUrl);
  const physicianCard = page.locator('[data-assistant="physician"]');
  await expect(physicianCard).toContainText("ИИ-врач · второе мнение");
  await physicianCard.getByRole("link", { name: "Открыть второе мнение" }).click();
  await expect(page).toHaveURL(/\/assistants\/physician$/);

  const assistant = page.getByTestId("assistant-workspace");
  await expect(
    page.getByRole("heading", { level: 1, name: "ИИ-врач · второе мнение" }),
  ).toBeVisible();
  await expect(page.getByTestId("assistant-readiness")).toContainText("нет пола или года рождения");
  await expect(assistant).toContainText("1 подтверждённое значение");

  await assistant.getByRole("button", { name: "Создать диалог" }).click();
  await assistant.getByLabel("Название диалога").fill("Разбор анализов");
  await assistant.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page).toHaveURL(/\/assistants\/physician\?conversationId=[0-9a-f-]{36}$/);

  const gate = page.getByTestId("assistant-egress-gate");
  await expect(gate).toContainText("1 подтверждённое значение с напечатанными референсами");
  await expect(gate).toContainText("пол и год рождения пока не указаны");
  await expect(assistant.getByLabel("Сообщение ИИ-врачу")).toBeDisabled();
  await gate.getByRole("button", { name: "Подтвердить и продолжить" }).click();
  await expect(gate).toHaveCount(0);

  const composer = assistant.getByLabel("Сообщение ИИ-врачу");
  await composer.fill("Что значат мои анализы?");
  await assistant.getByRole("button", { name: "Отправить" }).click();
  const firstAnswer = page.getByTestId("assistant-answer").first();
  await expect(firstAnswer).toBeVisible({ timeout: 60_000 });
  await expect(firstAnswer).toContainText("Не хватает данных");
  await expect(firstAnswer).toContainText("Укажите пол в медицинском профиле");
  await expect(firstAnswer.getByTestId("assistant-urgency")).toContainText("Срочных действий нет");

  // Record sex and birth year, then ask again in the same conversation.
  await recordBasics(page, profileUrl, { sex: "female", birthYear: "1992" });

  await page.goto(`${profileUrl}/assistants/physician`);
  await expect(page.getByTestId("assistant-readiness")).toHaveCount(0);
  await assistant.getByRole("button", { name: "Разбор анализов" }).click();
  await expect(page.getByTestId("assistant-answer")).toHaveCount(1);
  await assistant.getByLabel("Сообщение ИИ-врачу").fill("А теперь?");
  await assistant.getByRole("button", { name: "Отправить" }).click();
  const answer = page.getByTestId("assistant-answer").nth(1);
  await expect(answer).toBeVisible({ timeout: 60_000 });
  await expect(answer.getByTestId("assistant-urgency")).toContainText(
    "Обсудите на плановом визите",
  );
  await expect(answer).toContainText("Что показывают значения");
  await expect(answer).toContainText("Вероятное объяснение");
  await expect(answer).toContainText("Синтетическое состояние A");
  await expect(answer).toContainText("уверенность снижена");
  await expect(answer).toContainText("Что обычно рассматривает врач");
  await expect(answer).toContainText("Вопрос врачу");
  await expect(answer).toContainText("Общая справка");
  const source = answer.getByRole("list", { name: "Источники" }).first().getByRole("link");
  await expect(source).toContainText("СИНТЕТИЧЕСКИЙ АНАЛИТ A 7.0 synthetic-unit");
  await expect(source).toContainText("стр. 1");
  await expect(source).toHaveAttribute("href", /\/documents\/[0-9a-f-]{36}$/);
  await expect(answer.getByRole("button", { name: "Журнал обмена" })).toBeVisible();

  await answer
    .getByRole("button", { name: "В план: подтвердить у специалиста (терапевт)" })
    .first()
    .click();
  await expect(answer.getByText("Добавлено в план: подтвердить у врача.")).toBeVisible();

  await page.goto(`${profileUrl}?tab=dossier`);
  const plan = page.getByRole("region", { name: "План заботы" });
  await expect(
    plan.getByText("Подтвердить у специалиста (терапевт): Синтетическое состояние A"),
  ).toBeVisible();
});
