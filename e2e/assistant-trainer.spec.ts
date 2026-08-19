import { expect, test } from "@playwright/test";
import { recordBasics } from "./support/dossier";
import { openReview, reviewWorkspace } from "./support/review";

// The training assistant end to end against the fake codex: its own room, activity blocks with a
// clearance state bound to the confirmed value's source, a walk that files into the activity lane
// and a strength load that files as the visit that clears it; then the person's own check-in on
// the plan, which the trainer reads on the next turn to decide whether to progress.

test("the training assistant programmes within clearance, files into the right lanes and reads the check-ins", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await openReview(page);
  const workspace = reviewWorkspace(page);
  await workspace.getByRole("button", { name: "Подтвердить результат" }).click();
  await expect(workspace.locator(".document-review-workspace__notice")).toHaveText(
    "Подтверждено пользователем",
  );

  const profileUrl = page.url().replace(/\/docs\/[0-9a-f-]{36}$/, "");
  await recordBasics(page, profileUrl, { sex: "male", birthYear: "1985" });

  await page.goto(profileUrl);
  const card = page.locator('[data-assistant="movement"]');
  await expect(card).toContainText("ИИ-тренер");
  await card.getByRole("link", { name: "Открыть активность" }).click();
  await expect(page).toHaveURL(/\/assistants\/trainer$/);

  const assistant = page.getByTestId("assistant-workspace");
  await expect(
    page.getByRole("heading", { level: 1, name: "ИИ-тренер · нагрузка по вашим данным" }),
  ).toBeVisible();
  await assistant.getByRole("button", { name: "Создать диалог" }).click();
  await assistant.getByLabel("Название диалога").fill("Нагрузка");
  await assistant.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page).toHaveURL(/\/assistants\/trainer\?conversationId=[0-9a-f-]{36}$/);

  const gate = page.getByTestId("assistant-egress-gate");
  await expect(gate).toContainText("ваши отметки по ним за последние 4 недели");
  await gate.getByRole("button", { name: "Подтвердить и продолжить" }).click();
  await expect(gate).toHaveCount(0);
  await expect(page.getByTestId("assistant-consilium-panel")).toHaveCount(0);

  await assistant.getByLabel("Сообщение ИИ-тренеру").fill("Как мне тренироваться?");
  await assistant.getByRole("button", { name: "Отправить" }).click();
  const answer = page.getByTestId("assistant-answer").first();
  await expect(answer).toBeVisible({ timeout: 60_000 });
  await expect(answer).toContainText("ИИ-тренер");
  await expect(answer).toContainText("Что значения говорят о нагрузке");
  await expect(answer).toContainText("Рекомендация по нагрузке");
  await expect(answer).toContainText("Быстрая ходьба");
  await expect(answer).toContainText("аэробная нагрузка");
  await expect(answer).toContainText("в рамках допуска");
  await expect(answer).toContainText("Нагрузка: 3 раза в неделю по 30 минут");
  await expect(answer).toContainText(
    "Прибавлять: пока держать ту же нагрузку; прибавлять, когда наберётся три недели регулярных отметок",
  );
  await expect(answer).toContainText("Силовые упражнения с отягощением");
  await expect(answer).toContainText("нужен допуск врача");
  await expect(answer).toContainText("чего избегать и когда остановиться");
  await expect(answer).toContainText("Что измерить снова");
  await expect(answer).toContainText("когда: через 6 недель");
  const source = answer.getByRole("list", { name: "Источники" }).first().getByRole("link");
  await expect(source).toContainText("СИНТЕТИЧЕСКИЙ АНАЛИТ A 7.0 synthetic-unit");

  await answer.getByRole("button", { name: "В план: активность" }).first().click();
  await expect(answer.getByText("Добавлено в план активности.").first()).toBeVisible();
  await answer.getByRole("button", { name: "В план: получить допуск (кардиолог)" }).click();
  await expect(answer.getByText("Добавлено в план: получить допуск.")).toBeVisible();

  // The plan: the walk in «Активность» with its diary strip, the clearance visit in «Специалисты».
  await page.goto(`${profileUrl}/dossier`);
  const plan = page.getByRole("region", { name: "План заботы" });
  const activityLane = plan.getByRole("region", { name: "Активность" });
  await expect(activityLane.getByText("Быстрая ходьба")).toBeVisible();
  await expect(
    plan
      .getByRole("region", { name: "Специалисты" })
      .getByText("Получить допуск к нагрузке (кардиолог): Силовые упражнения с отягощением"),
  ).toBeVisible();
  const checkins = activityLane.getByTestId("care-plan-checkins");
  await expect(checkins).toContainText("отметок за 4 недели пока нет");
  await expect(
    checkins.getByRole("list", { name: "Отметки за 4 недели" }).getByRole("listitem"),
  ).toHaveCount(28);
  await checkins.getByLabel("Заметка к отметке").fill("Прошёл 30 минут");
  await checkins.getByRole("button", { name: "Сделал" }).click();
  await expect(activityLane.getByTestId("care-plan-checkins")).toContainText(
    "сделано 1 · пропущено 0 за 4 недели",
  );
  await expect(
    activityLane.getByTestId("care-plan-checkins").getByRole("button", { name: "Сделал" }),
  ).toHaveAttribute("aria-pressed", "true");
  // The same day again replaces the mark — the diary is the person's to correct.
  await activityLane
    .getByTestId("care-plan-checkins")
    .getByRole("button", { name: "Пропустил" })
    .click();
  await expect(activityLane.getByTestId("care-plan-checkins")).toContainText(
    "сделано 0 · пропущено 1 за 4 недели",
  );
});
