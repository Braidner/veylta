import { expect, test } from "@playwright/test";
import { recordBasics } from "./support/dossier";
import { confirmResult, correctResult, openReview } from "./support/review";

// The dossier end to end: the passport asks for sex and birth year right there, Veylta reads
// every confirmed value against its printed reference and names the specialty for the ones
// outside it, a visit goes into the care plan on the same page, and every indicator's dynamics
// card links to its history.

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
  const passport = page.getByTestId("dossier-passport");
  await expect(passport).toContainText("пол и возраст не указаны");
  await expect(passport.getByTestId("dossier-basics")).toContainText(
    "Пол и год рождения — с них начинается любая интерпретация.",
  );
  const heading = page.locator(".profile-heading__access");
  await expect(heading.getByRole("link", { name: "Указать пол и год рождения" })).toBeVisible();
  await recordBasics(page, profileUrl, { sex: "female", birthYear: "1990" });
  await expect(passport.getByText("1990", { exact: true })).toBeVisible();
  // The heading's identity chip follows the passport without a reload.
  await expect(heading).toContainText("Женщина · 36 лет");
  await expect(heading.getByRole("link", { name: "Указать пол и год рождения" })).toHaveCount(0);

  const attention = page.getByTestId("dossier-attention");
  await expect(attention).toContainText("Требует внимания: 1 показатель");
  await expect(attention).toContainText("из 2 подтверждённых");
  const group = attention.locator('[data-specialty="endocrinologist"]');
  await expect(group).toContainText("К специалисту: эндокринолог");
  await expect(group).toContainText("ТТГ — 9.9 мМЕ/л");
  await expect(group).toContainText("выше референса лаборатории (5.0–8.0 synthetic-unit)");
  await expect(
    group.getByRole("link", { name: "Спросить ИИ-врача, насколько срочно" }),
  ).toHaveAttribute("href", /\/assistants\/physician$/);

  await group.getByRole("button", { name: "В план: визит" }).click();
  await expect(group).toContainText("В плане заботы");
  const plan = page.getByRole("region", { name: "План заботы" });
  await expect(plan.getByText("Визит: эндокринолог — ТТГ")).toBeVisible();

  const cards = page.getByTestId("dossier-indicator");
  await expect(cards).toHaveCount(2);
  const thyroid = cards.filter({ hasText: "ТТГ" });
  await expect(thyroid).toContainText("выше референса");
  await expect(thyroid).toContainText("9.9");
  await expect(thyroid).toContainText("референс 5.0–8.0 synthetic-unit");
  await expect(thyroid).toContainText("1 значение");
  await expect(thyroid.getByRole("link", { name: "История показателя" })).toHaveAttribute(
    "href",
    /\?tab=history&canonicalCode=tsh$/,
  );
  await expect(page.getByRole("heading", { name: "Щитовидная железа" })).toBeVisible();
  const other = cards.filter({ hasText: "СИНТЕТИЧЕСКИЙ АНАЛИТ B" });
  await expect(other).toContainText("в референсе");
  await expect(other).toContainText("12.5");

  // The passport survives a reload with the plan item and the assessment.
  await page.reload();
  await expect(page.getByTestId("dossier-passport")).toContainText("Женщина");
  await expect(page.getByTestId("dossier-attention")).toContainText(
    "Требует внимания: 1 показатель",
  );
  await expect(
    page.getByRole("region", { name: "План заботы" }).getByText("Визит: эндокринолог — ТТГ"),
  ).toBeVisible();
});
