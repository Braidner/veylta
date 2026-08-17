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
  const profileUrl = page.url().replace(/\/documents\/[0-9a-f-]{36}$/, "");

  await page.goto(`${profileUrl}?tab=dossier`);
  // The greeting steps aside: the passport is the page's identity.
  await expect(page.locator(".profile-heading")).toHaveCount(0);
  const passport = page.getByTestId("dossier-passport");
  await expect(passport).toContainText("пол и возраст не указаны");
  await expect(passport.getByTestId("dossier-basics")).toContainText(
    "Пол и год рождения — с них начинается любая интерпретация.",
  );
  await recordBasics(page, profileUrl, { sex: "female", birthYear: "1990" });
  await expect(passport.getByText("1990", { exact: true })).toBeVisible();

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
    /\?tab=history&canonicalCode=tsh$/,
  );
  await expect(
    group.getByRole("link", { name: "Спросить ИИ-врача, насколько срочно" }),
  ).toHaveAttribute("href", /\/assistants\/physician$/);

  await group.getByRole("button", { name: "В план: визит" }).click();
  await expect(group).toContainText("В плане заботы");
  const plan = page.getByRole("region", { name: "План заботы" });
  await expect(plan.getByText("Визит: эндокринолог — ТТГ")).toBeVisible();

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
  await page.goto(`${profileUrl}?tab=dossier`);
  await expect(page.getByTestId("dossier-passport")).toContainText("Женщина");
  await expect(page.getByTestId("dossier-attention")).toContainText(
    "Требуют внимания: 1 показатель",
  );
  await expect(
    page.getByRole("region", { name: "План заботы" }).getByText("Визит: эндокринолог — ТТГ"),
  ).toBeVisible();
});
