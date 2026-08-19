import { expect, test } from "@playwright/test";
import { recordBasics } from "./support/dossier";
import { openReview, reviewWorkspace } from "./support/review";

// The nutrition assistant end to end against the fake codex: its own room without personas or a
// консилиум, the same egress gate, diet blocks bound to the confirmed value's source, an interaction
// flagged against the profile, and the plan lanes a recommendation and a recheck land in.

test("the nutrition assistant answers alone, flags an interaction and files its plan into the right lanes", async ({
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

  await page.goto(profileUrl);
  const card = page.locator('[data-assistant="nutrition"]');
  await expect(card).toContainText("ИИ-нутрициолог");
  await card.getByRole("link", { name: "Открыть питание" }).click();
  await expect(page).toHaveURL(/\/assistants\/nutritionist$/);

  const assistant = page.getByTestId("assistant-workspace");
  await expect(
    page.getByRole("heading", { level: 1, name: "ИИ-нутрициолог · питание по вашим данным" }),
  ).toBeVisible();
  await expect(page.getByTestId("assistant-readiness")).toHaveCount(0);
  await expect(assistant).toContainText("1 подтверждённое значение");

  await assistant.getByRole("button", { name: "Создать диалог" }).click();
  await assistant.getByLabel("Название диалога").fill("Питание");
  await assistant.getByRole("button", { name: "Создать", exact: true }).click();
  await expect(page).toHaveURL(/\/assistants\/nutritionist\?conversationId=[0-9a-f-]{36}$/);

  const gate = page.getByTestId("assistant-egress-gate");
  await expect(gate).toContainText("1 подтверждённое значение с напечатанными референсами");
  await expect(assistant.getByLabel("Сообщение ИИ-нутрициологу")).toBeDisabled();
  await gate.getByRole("button", { name: "Подтвердить и продолжить" }).click();
  await expect(gate).toHaveCount(0);

  // No recipients row: the nutritionist answers alone.
  await expect(page.getByTestId("assistant-consilium-panel")).toHaveCount(0);
  await expect(page.getByTestId("assistant-openers")).toContainText(
    "Как мне питаться при таких значениях?",
  );
  await assistant.getByLabel("Сообщение ИИ-нутрициологу").fill("Как мне питаться?");
  await assistant.getByRole("button", { name: "Отправить" }).click();
  const answer = page.getByTestId("assistant-answer").first();
  await expect(answer).toBeVisible({ timeout: 60_000 });
  await expect(answer).toContainText("ИИ-нутрициолог");
  await expect(answer.getByTestId("assistant-urgency")).toContainText(
    "Обсудите на плановом визите",
  );
  await expect(answer).toContainText("Что значения говорят о питании");
  await expect(answer).toContainText("Рекомендация по питанию");
  await expect(answer).toContainText("Больше растворимой клетчатки");
  await expect(answer).toContainText("добавить в рацион");
  await expect(answer).toContainText("Препараты омега-3");
  await expect(answer).toContainText("добавка — без дозы");
  await expect(answer).toContainText("сверено с профилем: есть взаимодействие");
  await expect(answer).toContainText("Что измерить снова");
  await expect(answer).toContainText("когда: через 3 месяца");
  const source = answer.getByRole("list", { name: "Источники" }).first().getByRole("link");
  await expect(source).toContainText("СИНТЕТИЧЕСКИЙ АНАЛИТ A 7.0 synthetic-unit");
  await expect(source).toHaveAttribute("href", /\/[a-z0-9-]+\/docs\/[0-9a-f-]{36}$/);

  await answer.getByRole("button", { name: "В план: питание" }).first().click();
  await expect(answer.getByText("Добавлено в план питания.")).toBeVisible();
  await answer.getByRole("button", { name: "В план: повторить анализ" }).click();
  await expect(answer.getByText("Добавлено в план: повторить анализ.")).toBeVisible();

  await page.goto(`${profileUrl}/dossier`);
  const plan = page.getByRole("region", { name: "План заботы" });
  await expect(
    plan.getByRole("region", { name: "Питание" }).getByText("Больше растворимой клетчатки"),
  ).toBeVisible();
  await expect(
    plan
      .getByRole("region", { name: "Анализы" })
      .getByText("Повторить синтетический показатель A после изменения рациона."),
  ).toBeVisible();
});
