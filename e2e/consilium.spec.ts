import { expect, test } from "@playwright/test";
import { recordBasics } from "./support/dossier";
import { correctResult, openReview } from "./support/review";

// The консилиум end to end against the fake codex: a corrected ТТГ convenes the endocrinologist
// and a corrected гемоглобин the hematologist, each for a stated reason; their opinions stand
// side by side under the therapist's synthesis, the disagreement is shown, the synthesis carries
// the highest urgency; a chip addresses one persona inside the same conversation.

test("the консилиум convenes the specialties the evidence names and keeps every opinion", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openReview(page);
  await correctResult(page, "synthetic-analyte-a", { name: "ТТГ", value: "6.8", unit: "мМЕ/л" });
  await correctResult(page, "synthetic-analyte-b", {
    name: "Гемоглобин",
    value: "9.8",
    unit: "г/дл",
  });

  const profileUrl = page.url().replace(/\/documents\/[0-9a-f-]{36}$/, "");
  await recordBasics(page, profileUrl, { sex: "female", birthYear: "1990" });

  await page.goto(`${profileUrl}/assistants/physician`);
  const assistant = page.getByTestId("assistant-workspace");
  await assistant.getByRole("button", { name: "Создать диалог" }).click();
  await assistant.getByLabel("Название диалога").fill("Консилиум по анализам");
  await assistant.getByRole("button", { name: "Создать", exact: true }).click();
  await page.getByTestId("assistant-egress-gate").getByRole("button").click();

  const panel = page.getByTestId("assistant-consilium-panel");
  await expect(panel).toContainText("Консилиум по вашим данным");
  const endocrinologistChip = panel.getByRole("button", { name: /эндокринолог/ });
  await expect(endocrinologistChip).toContainText("в данных: ТТГ");
  await expect(panel.getByRole("button", { name: /гематолог/ })).toContainText(
    "в данных: Гемоглобин",
  );

  await assistant.getByLabel("Сообщение ИИ-врачу").fill("Что вы думаете все вместе?");
  await assistant.getByRole("button", { name: "Собрать консилиум" }).click();
  await expect(
    assistant.getByRole("status").filter({ hasText: "Консилиум работает" }),
  ).toBeVisible();
  const synthesis = page.getByTestId("assistant-answer").filter({ hasText: "синтез консилиума" });
  await expect(synthesis).toBeVisible({ timeout: 60_000 });
  await expect(synthesis.getByTestId("assistant-urgency")).toContainText(
    "Запишитесь к врачу в ближайшие недели",
  );
  const consilium = synthesis.getByTestId("assistant-consilium");
  const endocrinologist = consilium.locator('[data-specialty="endocrinologist"]');
  const hematologist = consilium.locator('[data-specialty="hematologist"]');
  await expect(endocrinologist).toContainText("в данных: ТТГ");
  await expect(endocrinologist).toContainText("Запишитесь к врачу в ближайшие недели");
  await expect(endocrinologist).toContainText("Синтетический субклинический гипотиреоз");
  await expect(hematologist).toContainText("Обсудите на плановом визите");
  await expect(hematologist).toContainText("Синтетическая лёгкая анемия");
  await expect(consilium.getByText("Где мнения сходятся и расходятся")).toBeVisible();
  await expect(consilium.getByText("расходятся", { exact: true })).toBeVisible();
  await expect(consilium).toContainText("Срочность визита");
  await expect(consilium).toContainText("эндокринолог, гематолог");

  await endocrinologistChip.click();
  await expect(assistant.getByLabel("Вопрос специалисту: эндокринолог")).toBeVisible();
  await assistant.getByLabel("Вопрос специалисту: эндокринолог").fill("А ваше мнение отдельно?");
  await assistant.getByRole("button", { name: "Отправить" }).click();
  const reply = page.getByTestId("assistant-answer").last();
  await expect(reply).toContainText("ИИ-эндокринолог", { timeout: 60_000 });
  await expect(reply).toContainText("Синтетический субклинический гипотиреоз");
  await expect(assistant.getByText("Вопрос: эндокринолог")).toBeVisible();
  await expect(assistant.getByLabel("Сообщение ИИ-врачу")).toBeVisible();

  await page.reload();
  await expect(
    page.getByTestId("assistant-answer").filter({ hasText: "синтез консилиума" }),
  ).toBeVisible();
  await expect(page.getByTestId("assistant-consilium").locator("[data-specialty]")).toHaveCount(2);
});
