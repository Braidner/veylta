import { expect, test } from "@playwright/test";
import { recordBasics } from "./support/dossier";
import { openReview, reviewWorkspace } from "./support/review";

// The outcome log end to end: under a hypothesis the person records what the clinician said —
// verdict, day, note — the block shows the word as one line, the room's rail counts it and lists
// the case; a second word on the same block replaces the first (the earlier one is kept below).

test("the person records the clinician's word on a proposed block and the room's log counts it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openReview(page);
  const workspace = reviewWorkspace(page);
  await workspace.getByRole("button", { name: "Подтвердить результат" }).click();
  await expect(workspace.locator(".document-review-workspace__notice")).toHaveText(
    "Подтверждено пользователем",
  );
  const profileUrl = page.url().replace(/\/docs\/[0-9a-f-]{36}$/, "");
  await recordBasics(page, profileUrl, { sex: "female", birthYear: "1992" });

  await page.goto(`${profileUrl}/assistants/physician`);
  const assistant = page.getByTestId("assistant-workspace");
  await expect(page.getByTestId("assistant-outcomes")).toContainText(
    "Здесь соберётся, что сказал врач о предложенном",
  );
  await assistant.getByRole("button", { name: "Создать диалог" }).click();
  await assistant.getByLabel("Название диалога").fill("Разбор анализов");
  await assistant.getByRole("button", { name: "Создать", exact: true }).click();
  await page
    .getByTestId("assistant-egress-gate")
    .getByRole("button", { name: "Подтвердить и продолжить" })
    .click();
  await assistant.getByLabel("Сообщение ИИ-врачу").fill("Что значат мои анализы?");
  await assistant.getByRole("button", { name: "Отправить" }).click();
  const answer = page.getByTestId("assistant-answer").first();
  await expect(answer).toBeVisible({ timeout: 60_000 });
  await expect(answer).toContainText("Синтетическое состояние A");

  // The hypothesis block: «Что сказал врач?» → modified, dated, with a note.
  const hypothesis = answer.locator(".assistant-block--hypothesis").first();
  await hypothesis.getByRole("button", { name: "Что сказал врач?" }).click();
  const form = hypothesis.getByRole("form", { name: "Что сказал врач" });
  await form.getByRole("button", { name: "Изменил" }).click();
  await form.getByLabel("Когда сказал").fill("2026-08-10");
  await form.getByLabel("Заметка").fill("Назвал другое состояние, направление оставил.");
  await form.getByRole("button", { name: "Сохранить" }).click();
  await expect(hypothesis.getByTestId("assistant-outcome")).toContainText(
    "Врач изменил · 10 августа 2026 г. · Назвал другое состояние, направление оставил.",
  );
  const log = page.getByTestId("assistant-outcomes");
  await expect(log).toContainText("подтверждено 0 · изменено 1 · отклонено 0");
  await expect(log).toContainText("сверка: согласен 0 · расходится 0 · не оценить 0");
  await expect(log.getByRole("button", { name: "Синтетическое состояние A" })).toBeVisible();

  // The same block again: the latest word stands and the count follows it.
  await hypothesis.getByRole("button", { name: "Изменить слово врача" }).click();
  await hypothesis
    .getByRole("form", { name: "Что сказал врач" })
    .getByRole("button", { name: "Подтвердил" })
    .click();
  await hypothesis
    .getByRole("form", { name: "Что сказал врач" })
    .getByRole("button", { name: "Сохранить" })
    .click();
  await expect(hypothesis.getByTestId("assistant-outcome")).toContainText("Врач подтвердил");
  await expect(log).toContainText("подтверждено 1 · изменено 0 · отклонено 0");

  // A question block offers no such control; the treatment option does.
  await expect(
    answer.locator(".assistant-block--question").getByRole("button", { name: "Что сказал врач?" }),
  ).toHaveCount(0);
  await expect(
    answer
      .locator(".assistant-block--treatment_option")
      .getByRole("button", { name: "Что сказал врач?" }),
  ).toBeVisible();
});
