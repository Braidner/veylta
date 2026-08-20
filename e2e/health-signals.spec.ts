import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { distinctSyntheticDocument, uploadSyntheticDocument } from "./support/document-upload";
import { confirmResult, correctResult, openReview } from "./support/review";

// «Сигналы здоровья» end to end — the overview panel that shows what the record looks like: the
// three named states as one proportional bar, and every indicator standing outside placed on the
// band its own source printed, with its run behind it. Never a score, a ring, or a grade.

const fixtureUrl = new URL("../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url);
const printedName = "СИНТЕТИЧЕСКИЙ АНАЛИТ A";
/** The indicator's reading, above the reference its own laboratory printed. */
const above = { name: printedName, value: "9.9", unit: "synthetic-unit" };

/** One more synthetic report of the same laboratory, so an indicator has a run and not a point. */
async function uploadAnotherReport(page: Page, profileUrl: string): Promise<void> {
  const name = `signals-${crypto.randomUUID().slice(0, 8)}.pdf`;
  await page.goto(profileUrl);
  await uploadSyntheticDocument(page, {
    name,
    mimeType: "application/pdf",
    buffer: distinctSyntheticDocument(await readFile(fixtureUrl), name),
  });
  await expect(page).toHaveURL(/\/[a-z0-9-]+\/docs\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Результаты исследования" })).toBeVisible();
}

test("the panel draws the record: a counted bar, and each named value on its own printed band", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openReview(page);
  const profileUrl = page.url().replace(/\/docs\/[0-9a-f-]{36}$/, "");
  // One indicator read twice above its printed 5.0–8.0, and one that stays inside. Both readings
  // of the run carry the same value: two reports of one fixture print one sample date, so which
  // of them the record calls the latest is not ordered — what it says about the indicator is.
  await correctResult(page, "synthetic-analyte-a", above);
  await confirmResult(page, "synthetic-analyte-b");
  await uploadAnotherReport(page, profileUrl);
  await correctResult(page, "synthetic-analyte-a", above);

  await page.goto(profileUrl);
  const signals = page.getByRole("region", { name: "Сигналы здоровья" });
  // The bar is the record's three counted states; each segment says its number and its word.
  const bar = signals.getByRole("img", { name: "2 показателя · 1 вне референса · 1 в пределах" });
  await expect(bar).toBeVisible();
  await expect(bar.locator(".dossier-strip__segment")).toHaveCount(2);
  await expect(signals.getByRole("link", { name: "1 вне референса" })).toHaveAttribute(
    "href",
    /\/[a-z0-9-]+\/dossier$/,
  );
  await expect(signals.getByText("1 в пределах", { exact: true })).toBeVisible();

  // The named indicator is placed, not graded: the printed bounds as a track with the value on
  // it, and the indicator's own run behind it.
  const card = signals.getByTestId("signal-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(printedName);
  await expect(card).toContainText("9.9 synthetic-unit");
  await expect(card).toContainText("выше 5.0–8.0 synthetic-unit");
  await expect(
    card.getByRole("img", { name: `${printedName}: выше 5.0–8.0 synthetic-unit` }),
  ).toBeVisible();
  await expect(card.locator(".dossier-gauge__band")).toHaveCount(1);
  await expect(card.locator(".dossier-gauge__marker")).toHaveCount(1);
  await expect(card.locator(".dossier-gauge__bounds")).toHaveText("5.08.0");
  await expect(
    card.getByRole("img", { name: `${printedName}: 2 значения во времени` }),
  ).toBeVisible();
  await expect(card).toContainText("терапевт");
  await expect(card.getByRole("link").first()).toHaveAttribute(
    "href",
    /\/[a-z0-9-]+\/history\?code=synthetic-analyte-a$/,
  );

  // The bookkeeping is a chip row under the cards: the waiting one is an action, the archive
  // states itself and names the last source it holds.
  await expect(signals.getByRole("link", { name: "Ждёт проверки 1" })).toHaveAttribute(
    "href",
    /\/[a-z0-9-]+\/docs$/,
  );
  await expect(signals.getByText(/^Документов 2 · последний /)).toBeVisible();
  await expect(
    signals.getByText(/Оценка Veylta по печатным диапазонам ваших источников, а не диагноз/),
  ).toBeVisible();

  // The panel gained a picture, not height: the dashboard still fits its viewport on both axes.
  const fit = await page.evaluate(() => ({
    viewport: window.innerHeight,
    page: document.documentElement.scrollHeight,
    overflows: document.documentElement.scrollWidth > window.innerWidth,
  }));
  expect(fit.page).toBeLessThanOrEqual(fit.viewport + 1);
  expect(fit.overflows).toBe(false);
});
