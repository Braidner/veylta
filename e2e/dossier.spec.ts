import { expect, test } from "@playwright/test";
import { recordBasics } from "./support/dossier";
import { confirmResult, correctResult, openReview } from "./support/review";

// The dossier end to end — the cabinet a person shows their doctor: the passport asks for sex
// and birth year right there, the rail lists the record's areas with what stands outside, the
// page in focus reads every confirmed value against its printed reference on a scale, names the
// specialty, puts a visit into the care plan on the same page, and every card links to history.

test("the dossier reads confirmed values against their references and sends the person to a doctor", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openReview(page);
  // ТТГ corrected above the printed 5.0–8.0 → the endocrinologist; analyte B confirmed as printed.
  await correctResult(page, "synthetic-analyte-a", { name: "ТТГ", value: "9.9", unit: "мМЕ/л" });
  await confirmResult(page, "synthetic-analyte-b");
  const profileUrl = page.url().replace(/\/docs\/[0-9a-f-]{36}$/, "");

  await page.goto(`${profileUrl}/dossier`);
  // The greeting steps aside: the passport is the page's identity.
  await expect(page.locator(".profile-heading")).toHaveCount(0);
  const passport = page.getByTestId("dossier-passport");
  await expect(passport).toContainText("пол и возраст не указаны");
  await expect(passport.getByTestId("dossier-basics")).toContainText(
    "Пол и год рождения — с них начинается любая интерпретация.",
  );
  await recordBasics(page, profileUrl, { sex: "female", birthYear: "1990" });
  await expect(passport).toContainText("Женщина · 36 лет · 1990");

  // Weight and height are the person's own series: a new value is a new dated entry, the
  // previous stays in the history, the change and the BMI follow.
  const weight = passport.getByTestId("dossier-measure-weight_kg");
  await expect(weight).toContainText("не указан");
  await weight.getByRole("button", { name: "Указать" }).click();
  await weight.getByLabel("Вес, кг").fill("70");
  await weight.getByRole("button", { name: "Сохранить" }).click();
  await expect(weight).toContainText("70 кг");
  await weight.getByRole("button", { name: "Обновить" }).click();
  await weight.getByLabel("Вес, кг").fill("71,5");
  await weight.getByRole("button", { name: "Сохранить" }).click();
  await expect(weight).toContainText("71,5 кг");
  await expect(weight.locator(".dossier-gauge__delta")).toHaveText("+1,5");
  await expect(weight.getByRole("img", { name: "Вес: 2 записей во времени" })).toBeVisible();
  const height = passport.getByTestId("dossier-measure-height_cm");
  await height.getByRole("button", { name: "Указать" }).click();
  await height.getByLabel("Рост, см").fill("175");
  await height.getByRole("button", { name: "Сохранить" }).click();
  await expect(height).toContainText("175 см");
  await expect(passport.getByTestId("dossier-measure-bmi")).toContainText("23,3");

  // The rail: the whole record, then the areas with data, each with its count and what is outside.
  const rail = page.getByTestId("dossier-rail");
  const all = rail.getByRole("button", { name: /^Всё досье/ });
  await expect(all).toHaveAttribute("aria-current", "true");
  await expect(all).toContainText("2");
  const thyroid = rail.getByRole("button", {
    name: "Щитовидная железа: 1 показатель, 1 вне референса",
  });
  await expect(thyroid.locator(".dossier-rail__alert")).toHaveText("1");
  await expect(rail.getByRole("button", { name: /^Другие показатели/ })).toBeVisible();

  const focus = page.getByTestId("dossier-focus");
  await expect(focus.getByRole("heading", { level: 2 })).toHaveText("Всё досье");
  await expect(focus).toContainText("2 показателя · 1 вне референса · 1 в референсе");
  const attention = page.getByTestId("dossier-attention");
  await expect(attention).toContainText("Требуют внимания: 1 показатель");
  const group = attention.locator('[data-specialty="endocrinologist"]');
  await expect(group).toContainText("К специалисту: эндокринолог");
  const card = group.getByTestId("dossier-gauge");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("ТТГ");
  await expect(card).toContainText("9.9");
  await expect(card).toContainText("выше референса");
  await expect(card.locator(".dossier-gauge__bounds")).toHaveText("5.08.0");
  await expect(card).toContainText("Щитовидная железа · читает эндокринолог");
  await expect(card.getByRole("link", { name: "История" })).toHaveAttribute(
    "href",
    /\/[a-z0-9-]+\/history\?code=tsh$/,
  );
  await expect(
    group.getByRole("link", { name: "Спросить ИИ-врача, насколько срочно" }),
  ).toHaveAttribute("href", /\/assistants\/physician\?ask=endocrinologist$/);

  await group.getByRole("button", { name: "В план: визит" }).click();
  await expect(group).toContainText("В плане заботы");
  const plan = page.getByRole("region", { name: "План заботы" });
  await expect(plan.getByText("Визит: эндокринолог — ТТГ")).toBeVisible();

  // «Спросить ИИ-врача» opens the conversation kept for this specialist — created once, found
  // afterwards — with the group's findings already in the field, addressed to the persona.
  await group.getByRole("link", { name: "Спросить ИИ-врача, насколько срочно" }).click();
  await expect(page).toHaveURL(/\/assistants\/physician\?conversationId=[0-9a-f-]{36}$/);
  const assistant = page.getByTestId("assistant-workspace");
  const dossierConversation = assistant.getByRole("button", { name: /Досье · Эндокринолог/ });
  await expect(dossierConversation).toHaveCount(1);
  await page.getByTestId("assistant-egress-gate").getByRole("button").click();
  const question = assistant.getByLabel("Вопрос специалисту: эндокринолог");
  await expect(question).toHaveValue(
    /^Насколько срочно показать эндокринологу эти значения из моего досье: ТТГ 9.9 мМЕ\/л — выше референса лаборатории \(5\.0–8\.0 synthetic-unit\)/,
  );
  await assistant.getByRole("button", { name: "Отправить" }).click();
  const reply = page.getByTestId("assistant-answer").last();
  await expect(reply).toContainText("ИИ-эндокринолог", { timeout: 60_000 });
  const conversationUrl = page.url();

  // The same group again lands in the same conversation, not a second one.
  await page.goto(`${profileUrl}/dossier`);
  await page
    .getByTestId("dossier-attention")
    .locator('[data-specialty="endocrinologist"]')
    .getByRole("link", { name: "Спросить ИИ-врача, насколько срочно" })
    .click();
  await expect(page).toHaveURL(conversationUrl);
  await expect(assistant.getByRole("button", { name: /Досье · Эндокринолог/ })).toHaveCount(1);
  await expect(page.getByTestId("assistant-answer")).toHaveCount(1);
  await expect(assistant.getByLabel("Вопрос специалисту: эндокринолог")).toHaveValue(
    /^Насколько срочно показать эндокринологу/,
  );

  // The whole record asks for a консилиум in its own conversation, the question ready to convene.
  await page.goto(`${profileUrl}/dossier`);
  await page.getByRole("link", { name: "Собрать консилиум по досье" }).click();
  await expect(assistant.getByRole("button", { name: /Досье · Консилиум/ })).toHaveCount(1);
  await page.getByTestId("assistant-egress-gate").getByRole("button").click();
  await expect(assistant.getByLabel("Вопрос консилиуму")).toHaveValue(
    /^Что в моём досье требует внимания в первую очередь и насколько срочно\? Вне референса: ТТГ 9\.9 мМЕ\/л/,
  );
  await expect(assistant.getByRole("button", { name: "Собрать консилиум" })).toBeEnabled();
  await page.goto(`${profileUrl}/dossier`);

  // Into one area from its tile, then from the rail.
  await focus.locator('.dossier-area-tile[data-area="thyroid"]').click();
  await expect(focus.getByRole("heading", { level: 2 })).toHaveText("Щитовидная железа");
  await expect(focus).toContainText("1 показатель · 1 вне референса · читает эндокринолог");
  await expect(thyroid).toHaveAttribute("aria-current", "true");
  await expect(focus.getByTestId("dossier-gauge")).toHaveCount(1);
  await expect(focus.getByTestId("dossier-gauge")).not.toContainText("читает эндокринолог");

  await rail.getByRole("button", { name: /^Другие показатели/ }).click();
  await expect(focus.getByRole("heading", { level: 2 })).toHaveText("Другие показатели");
  await expect(focus).toContainText("1 показатель · всё в референсе · читает терапевт");
  await expect(focus.getByTestId("dossier-attention")).toContainText("Требующих внимания нет");
  const other = focus.getByTestId("dossier-gauge");
  await expect(other).toHaveCount(1);
  await expect(other).toContainText("СИНТЕТИЧЕСКИЙ АНАЛИТ B");
  await expect(other).toContainText("в референсе");
  await expect(other).toContainText("12.5");
  await expect(other.locator(".dossier-gauge__bounds")).toHaveText("10.015.0");

  // The overview's identity chips follow the passport; the dossier survives a reload.
  await page.goto(profileUrl);
  await expect(page.locator(".profile-heading__access")).toContainText("Женщина · 36 лет");
  await expect(page.locator(".profile-heading__access")).toContainText("Рост 175 см");
  await expect(page.locator(".profile-heading__access")).toContainText("Вес 71,5 кг");

  // The overview states the same record: two confirmed values, one indicator outside, one source.
  const signals = page.getByRole("region", { name: "Сигналы здоровья" });
  const outside = signals.locator("a.health-signal--link");
  await expect(outside).toContainText("Вне референса");
  await expect(outside.locator("strong")).toHaveText("1");
  await expect(signals.locator(".health-signal", { hasText: "Подтверждено" })).toContainText(
    "2 значения связаны с источником",
  );
  await expect(signals.locator(".health-signal", { hasText: "Документов" })).toContainText(
    "Последний —",
  );
  // The row names the document, not the stored filename, and says what it left behind.
  const documentRow = page.locator(".dashboard-documents__list li").first();
  await expect(documentRow).toContainText("Синтетические лабораторные результаты");
  await expect(documentRow).toContainText("Анализы · ");
  await expect(documentRow).toContainText("разобрано 2");
  // The tile is one keyboard-reachable target, and it opens the dossier.
  await outside.focus();
  await expect(outside).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${profileUrl}/dossier`);
  await page.goto(`${profileUrl}/dossier`);
  await expect(page.getByTestId("dossier-passport")).toContainText("Женщина");
  await expect(page.getByTestId("dossier-attention")).toContainText(
    "Требуют внимания: 1 показатель",
  );
  await expect(
    page.getByRole("region", { name: "План заботы" }).getByText("Визит: эндокринолог — ТТГ"),
  ).toBeVisible();
});
