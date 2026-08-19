import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { distinctSyntheticDocument, uploadSyntheticDocument } from "./support/document-upload";
import { recordBasics } from "./support/dossier";
import { confirmResult, openReview, registerDemoFamily } from "./support/review";

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
  await expect(page).toHaveURL(/\/[a-z0-9-]+\/docs\/[0-9a-f-]{36}$/);

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

test("the сверка: confirmed records reach the ИИ-врач, who says where he agrees and where not", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // A confirmed value, a ready profile, then the note with the doctor's statements.
  await openReview(page);
  await confirmResult(page, "synthetic-analyte-a");
  const profileUrl = page.url().replace(/\/docs\/[0-9a-f-]{36}$/, "");
  await recordBasics(page, profileUrl, { sex: "female", birthYear: "1990" });
  await page.goto(profileUrl);
  const filename = `note-${crypto.randomUUID().slice(0, 8)}.pdf`;
  await uploadSyntheticDocument(page, {
    name: filename,
    mimeType: "application/pdf",
    buffer: distinctSyntheticDocument(noteBytes, filename),
  });
  const records = page.getByTestId("clinician-records");
  await expect(records).toBeVisible({ timeout: 30_000 });
  const rows = records.getByTestId("clinician-record");
  // Nothing to compare until a record is confirmed.
  await expect(records.getByRole("link", { name: "Сверить с ИИ-врачом" })).toHaveCount(0);
  await rows.nth(0).getByRole("button", { name: "Подтвердить" }).click();
  await expect(rows.nth(0)).toContainText("Подтверждено");
  await rows.nth(1).getByRole("button", { name: "Отклонить" }).click();

  // The question travels to the therapist's own dossier conversation, with the records in it.
  await records.getByRole("link", { name: "Сверить с ИИ-врачом" }).click();
  const assistant = page.getByTestId("assistant-workspace");
  await expect(assistant.getByRole("button", { name: /Досье · Терапевт/ })).toHaveCount(1);
  const gate = page.getByTestId("assistant-egress-gate");
  await expect(gate).toContainText("1 подтверждённая запись врача");
  await gate.getByRole("button").click();
  await expect(assistant.getByLabel("Сообщение ИИ-врачу")).toHaveValue(
    /^Сверь записи врача из документа от 12\.08\.2026 с моим досье и подтверждёнными значениями: Диагноз: Синтетический субклинический гипотиреоз \(E03\.9\)\. Где вы согласны/,
  );
  await assistant.getByRole("button", { name: "Отправить" }).click();
  const answer = page.getByTestId("assistant-answer").last();
  await expect(answer).toBeVisible({ timeout: 60_000 });
  await expect(answer).toContainText("Сверка с записью врача");
  await expect(answer).toContainText("Расходится — вопрос к визиту");
  await expect(answer).toContainText("Врач · Диагноз");
  await expect(
    answer.getByRole("link", {
      name: /Синтетический субклинический гипотиреоз · E03\.9 · 12 августа 2026 г\./,
    }),
  ).toHaveAttribute("href", /\/[a-z0-9-]+\/docs\/[0-9a-f-]{36}$/);
  await expect(answer).toContainText("ИИ-врач: По подтверждённым значениям картина ближе к норме");
  await expect(answer).toContainText("обсудить: эндокринолог");

  // Every «differs» becomes a question the person brings to the visit — into the plan.
  await answer.getByRole("button", { name: "В план: обсудить с врачом (эндокринолог)" }).click();
  await expect(answer.getByText("Добавлено в план: обсудить с врачом.")).toBeVisible();
  await page.goto(`${profileUrl}/dossier`);
  await expect(
    page
      .getByRole("region", { name: "План заботы" })
      .getByText("Обсудить с врачом (эндокринолог): Синтетический субклинический гипотиреоз"),
  ).toBeVisible();
});
