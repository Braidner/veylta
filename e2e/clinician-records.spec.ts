import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { distinctSyntheticDocument, uploadSyntheticDocument } from "./support/document-upload";
import { registerDemoFamily } from "./support/review";

// The clinician's own statements read out of a discharge note: listed with their page and
// fragment, decided one by one — as read, in the person's words, or rejected — and kept.

const noteFixture = new URL("../fixtures/veylta-synthetic-discharge-note.pdf", import.meta.url);
const noteBytes = await readFile(noteFixture);

test("the discharge note yields the doctor's records, each opening its fragment, decided one by one", async ({
  page,
}) => {
  await registerDemoFamily(page);
  const filename = `note-${crypto.randomUUID().slice(0, 8)}.pdf`;
  await uploadSyntheticDocument(page, {
    name: filename,
    mimeType: "application/pdf",
    buffer: distinctSyntheticDocument(noteBytes, filename),
  });
  await expect(page).toHaveURL(
    /\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}$/,
  );

  const records = page.getByTestId("clinician-records");
  await expect(records).toBeVisible({ timeout: 30_000 });
  await expect(records).toContainText("5 ждут решения");
  const rows = records.getByTestId("clinician-record");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText("Диагноз");
  await expect(rows.nth(0)).toContainText("Синтетический субклинический гипотиреоз · E03.9");
  await expect(rows.nth(0).getByRole("link", { name: /стр\. 1/ })).toContainText(
    "RECORD|diagnosis|Синтетический субклинический гипотиреоз|E03.9",
  );
  await expect(rows.nth(1)).toContainText("Назначение");
  await expect(rows.nth(2)).toContainText("Направление");
  await expect(rows.nth(3)).toContainText("Контроль");
  await expect(rows.nth(4)).toContainText("Наблюдение");

  // Confirm as read; confirm in the person's own words; reject.
  await rows.nth(0).getByRole("button", { name: "Подтвердить" }).click();
  await expect(rows.nth(0)).toContainText("Подтверждено");
  await rows.nth(1).getByRole("button", { name: "Уточнить формулировку" }).click();
  await rows.nth(1).getByLabel("Уточнение (доза, срок, кому)").fill("25 мкг утром");
  await rows.nth(1).getByRole("button", { name: "Подтвердить в этой формулировке" }).click();
  await expect(rows.nth(1)).toContainText("Синтетический левотироксин · 25 мкг утром");
  await expect(rows.nth(1)).toContainText(
    "В документе: Синтетический левотироксин · 25 мкг утром, 8 недель",
  );
  await rows.nth(4).getByRole("button", { name: "Отклонить" }).click();
  await expect(rows.nth(4)).toContainText("Отклонено");
  await expect(records).toContainText("2 подтверждены · 1 отклонена · 2 ждут решения");

  // Decisions survive a reload; the decided rows offer no second decision.
  await page.reload();
  const again = page.getByTestId("clinician-records").getByTestId("clinician-record");
  await expect(again).toHaveCount(5);
  await expect(again.nth(0)).toContainText("Подтверждено");
  await expect(again.nth(0).getByRole("button", { name: "Подтвердить" })).toHaveCount(0);
  await expect(again.nth(1)).toContainText("25 мкг утром");
  await expect(again.nth(4)).toContainText("Отклонено");
  await expect(again.nth(2).getByRole("button", { name: "Отклонить" })).toBeVisible();
});
