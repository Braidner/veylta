import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { distinctSyntheticDocument, uploadSyntheticDocument } from "./support/document-upload";
import { confirmResult, correctResult, resultCard, reviewWorkspace } from "./support/review";
import { createSyntheticFamily } from "./support/synthetic-family";

// История end to end — what a person opens to see one indicator over time: «что изменилось»
// counts the record's own movement over the period, the rail chooses an indicator, the chart
// puts every confirmed value against the reference its laboratory printed, and each point leads
// back to the document it came from. Nothing here is interpreted; the numbers keep their sources.

const syntheticLabFixture = new URL("../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url);
const syntheticLabBytes = await readFile(syntheticLabFixture);
const printedName = "СИНТЕТИЧЕСКИЙ АНАЛИТ A";

function syntheticNames() {
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    owner: `Владелец history ${suffix}`,
    family: `Семья history ${suffix}`,
    profile: `Профиль history ${suffix}`,
  };
}

async function registerDemoFamily(page: Page): Promise<string> {
  return createSyntheticFamily(page, syntheticNames());
}

/** Uploads one synthetic report from the person's own page and waits for its review to open. */
async function uploadReport(page: Page, profileUrl: string, identity: string): Promise<void> {
  await page.goto(profileUrl);
  const name = `history-${identity}-${crypto.randomUUID().slice(0, 8)}.pdf`;
  await uploadSyntheticDocument(page, {
    name,
    mimeType: "application/pdf",
    buffer: distinctSyntheticDocument(syntheticLabBytes, name),
  });
  await expect(page).toHaveURL(/\/[a-z0-9-]+\/docs\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Результаты исследования" })).toBeVisible();
}

async function rejectResult(page: Page, factKey: string): Promise<void> {
  const workspace = reviewWorkspace(page);
  await resultCard(page, factKey).click();
  await workspace.getByRole("button", { name: "Отклонить результат" }).click();
  await expect(workspace.locator(".document-review-workspace__notice")).toHaveText(
    "Отклонено пользователем",
  );
}

async function openHistory(page: Page, profileUrl: string): Promise<void> {
  await page.getByRole("tab", { name: "История", exact: true }).click();
  await expect(page).toHaveURL(`${profileUrl}/history`);
}

/** The chart of one indicator, told apart from the rail's sparklines by its own aria-label. */
function chartOf(page: Page, name: string) {
  return page.getByRole("img", { name: new RegExp(`^${name}: значения за период`) });
}

/**
 * Which indicator the page is showing, asked without the calendar: the chart drops points outside
 * the period, so only under «Всё» can a run years from now still expect one. The heading stands.
 */
function selectedIndicator(page: Page, name: string) {
  return page.getByRole("heading", { name, level: 3 });
}

test("profile history shows confirmed and corrected observations with their authorized sources only", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const profileUrl = await registerDemoFamily(page);

  await uploadReport(page, profileUrl, "confirm");
  await confirmResult(page, "synthetic-analyte-a");
  await rejectResult(page, "synthetic-analyte-b");
  await openHistory(page, profileUrl);

  const values = page.getByRole("region", { name: "История подтверждённых значений" });
  await expect(
    values.getByRole("heading", { name: "История подтверждённых значений" }),
  ).toBeVisible();
  await expect(values.locator("tbody tr")).toHaveCount(1);
  await expect(values.getByText(printedName, { exact: true })).toBeVisible();
  await expect(values.getByText("7.0 synthetic-unit", { exact: true })).toBeVisible();
  await expect(values.getByText("СИНТЕТИЧЕСКИЙ АНАЛИТ B", { exact: true })).toHaveCount(0);

  // A second report, corrected in place: one indicator, both values, both sources.
  await uploadReport(page, profileUrl, "correct");
  await correctResult(page, "synthetic-analyte-a", {
    name: printedName,
    value: "7.1",
    unit: "synthetic-unit",
  });
  await rejectResult(page, "synthetic-analyte-b");
  await openHistory(page, profileUrl);

  await expect(values.locator("tbody tr")).toHaveCount(2);
  await expect(values.getByText("7.0 synthetic-unit", { exact: true })).toBeVisible();
  await expect(values.getByText("7.1 synthetic-unit", { exact: true })).toBeVisible();
  await expect(values.getByText("СИНТЕТИЧЕСКИЙ АНАЛИТ B", { exact: true })).toHaveCount(0);

  const sourceDetails = values.locator("details").first();
  await sourceDetails.locator("summary").click();
  await expect(sourceDetails.getByText("Нормализованное значение", { exact: true })).toBeVisible();
  await expect(sourceDetails.getByText("Не рассчитано", { exact: true })).toBeVisible();
  await expect(sourceDetails.getByText("Фрагмент из исходника", { exact: true })).toBeVisible();
  await expect(sourceDetails.getByText(/FACT\|synthetic-analyte-a/)).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await sourceDetails.getByRole("link", { name: "Открыть исходник" }).click();
  await expect(await downloadPromise).toBeTruthy();
});

test("the summary counts the record's movement, the rail selects, the chart binds each point to its source", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const profileUrl = await registerDemoFamily(page);

  // The first report as printed: 7.0 inside 5.0–8.0, and a second indicator to choose between.
  await uploadReport(page, profileUrl, "within");
  await confirmResult(page, "synthetic-analyte-a");
  await confirmResult(page, "synthetic-analyte-b");
  // The second report corrected to 9.9 — outside the same printed reference; the series moves out.
  await uploadReport(page, profileUrl, "above");
  await correctResult(page, "synthetic-analyte-a", {
    name: printedName,
    value: "9.9",
    unit: "synthetic-unit",
  });
  await openHistory(page, profileUrl);

  // «Что изменилось» counts by the record's own status rule. Counts are asserted under «Всё»
  // only: the fixture's dates are the run's own clock, so a bounded period would rot.
  const summary = page.getByRole("region", { name: "Что изменилось" });
  await summary.getByRole("button", { name: "Всё" }).click();
  await expect(summary.getByRole("button", { name: "Всё" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const movedOut = summary.locator('[data-bucket="moved_outside"]');
  await expect(movedOut.getByText("Вышли за референс", { exact: true })).toBeVisible();
  await expect(movedOut.locator(".history-summary__count")).toHaveText("1");
  const chip = movedOut.getByRole("button", { name: printedName, exact: true });
  await expect(chip).toBeVisible();

  // The rail chooses another indicator; the summary's chip brings the moved one back.
  const rail = page.getByRole("navigation", { name: "Показатели" });
  await rail.getByRole("button", { name: /СИНТЕТИЧЕСКИЙ АНАЛИТ B/ }).click();
  await expect(chartOf(page, "СИНТЕТИЧЕСКИЙ АНАЛИТ B")).toBeVisible();
  await chip.click();
  await expect(chartOf(page, printedName)).toBeVisible();
  await expect(page.locator(".history-chart__point.is-within")).toHaveCount(1);
  await expect(page.locator(".history-chart__point.is-above")).toHaveCount(1);

  // A point is its value's source: the document the value was confirmed from.
  await page.locator(".history-chart__point.is-above").click();
  await expect(page).toHaveURL(/\/docs\/[0-9a-f-]{36}$/);
  await page.goBack();
  // Back on a freshly mounted page the period is the default one, so the selection is asked for
  // by its heading — the chart holds only what the period contains.
  await expect(selectedIndicator(page, printedName)).toBeVisible();

  // Under the chart, the same values in full — each with the fragment and the source it came from.
  const values = page.getByRole("region", { name: "История подтверждённых значений" });
  await expect(values.locator("tbody tr")).toHaveCount(2);
  await values.locator("details").first().locator("summary").click();
  await expect(values.getByRole("link", { name: "Открыть исходник" }).first()).toBeVisible();

  // The rail's filter narrows to nothing and says so; a `?code=` link selects the indicator.
  await page.getByPlaceholder("Найти показатель").fill("нет такого");
  await expect(rail.locator("li")).toHaveCount(0);
  await expect(rail.getByText("По этому запросу показателей нет", { exact: false })).toBeVisible();
  await page.goto(`${profileUrl}/history?code=synthetic-analyte-a`);
  await expect(selectedIndicator(page, printedName)).toBeVisible();

  // The period switch presses one button and only one; nothing period-dependent is asserted here.
  await summary.getByRole("button", { name: "3 мес" }).click();
  await expect(summary.getByRole("button", { name: "3 мес" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (const other of ["6 мес", "Год", "Всё"]) {
    await expect(summary.getByRole("button", { name: other })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  }
  await expect(selectedIndicator(page, printedName)).toBeVisible();
});

test("the page's anchors exist before its values do", async ({ page }) => {
  const profileUrl = await registerDemoFamily(page);
  // The values are held until this test releases them: a hash the router cannot match at first
  // paint is dropped without a retry, so «Открыть всю историю» (#observation-history) and
  // «Найти показатель» (#indicator-catalog) must land on a page that is still loading.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holds = 0;
  await page.route(
    (url) => url.pathname.endsWith("/observations"),
    async (route) => {
      holds += 1;
      await held;
      await route.continue();
    },
  );

  await page.goto(`${profileUrl}/history#observation-history`);
  await expect(page.getByText("Загружаем подтверждённые значения и их источники…")).toBeVisible();
  await expect(page.locator("#observation-history")).toBeVisible();
  await expect(page.locator("#indicator-catalog")).toBeVisible();
  await expect(page).toHaveURL(`${profileUrl}/history#observation-history`);
  expect(holds).toBeGreaterThan(0);

  release();
  await expect(page.getByText("Пока нет подтверждённых значений", { exact: false })).toBeVisible();
});
