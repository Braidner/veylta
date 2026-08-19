import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { createSyntheticLabImage } from "../apps/api/test/synthetic-lab-image.js";
import { uploadSyntheticDocument } from "./support/document-upload";
import { createSyntheticFamily } from "./support/synthetic-family";

const syntheticLabFixture = new URL("../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url);
const syntheticLabBytes = await readFile(syntheticLabFixture);

function syntheticNames() {
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    owner: `Владелец ${suffix}`,
    family: `Семья ${suffix}`,
    profile: `Профиль ${suffix}`,
  };
}

function syntheticPdf(label: string): Buffer {
  return Buffer.from(
    `%PDF-1.7\n% Veylta synthetic fixture\n1 0 obj\n<< /Type /Catalog /Label (${label}) >>\nendobj\n%%EOF\n`,
    "utf8",
  );
}

async function registerDemoFamily(page: Page) {
  const names = syntheticNames();
  const profileUrl = await createSyntheticFamily(page, names);
  return { names, profileUrl };
}

async function uploadPdf(
  page: Page,
  filename: string,
  buffer: Buffer,
  mimeType = "application/pdf",
) {
  await uploadSyntheticDocument(page, { name: filename, mimeType, buffer });
}

test("a synthetic report is extracted, survives reload, preserves its filename, and reuses a duplicate", async ({
  page,
}) => {
  const { profileUrl } = await registerDemoFamily(page);
  const filename = `synthetic-lab-${crypto.randomUUID().slice(0, 8)}.pdf`;
  const bytes = syntheticLabBytes;

  await uploadPdf(page, filename, bytes);

  await expect(page).toHaveURL(/\/[a-z0-9-]+\/docs\/[0-9a-f-]{36}$/);
  const firstDocumentUrl = page.url();
  await expect(page.locator("#document-title")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Черновые значения ждут проверки" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Первичный анализ/ }).click();
  const activity = page.getByRole("region", { name: "Первичный анализ" });
  await expect(activity.getByText("Документ поставлен в очередь")).toBeVisible();
  await expect(activity.getByText("Codex разбирает данные документа")).toBeVisible();
  await expect(activity.getByText("Результат сохранён для проверки")).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(firstDocumentUrl);
  await expect(
    page.getByRole("heading", { level: 1, name: "Синтетические лабораторные результаты" }),
  ).toBeVisible();
  await expect(page.getByText(filename, { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: /Первичный анализ/ }).click();
  await expect(
    page
      .getByRole("region", { name: "Первичный анализ" })
      .getByText("Результат сохранён для проверки"),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Скачать" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(filename);

  await page.getByRole("tab", { name: "Документы", exact: true }).click();
  await expect(page).toHaveURL(`${profileUrl}/docs`);
  const overview = page.getByRole("region", { name: "Архив документов" });
  // One list: the source awaiting a decision sits at the top with its two counts.
  await expect(overview.getByRole("region", { name: "Документы", exact: true })).toBeVisible();
  // The queue names the two kinds of pending value, each beside the verb that handles it.
  await expect(overview.getByText("1 значение без замечаний")).toBeVisible();
  await expect(overview.getByText("1 значение требует отдельной проверки")).toBeVisible();
  await expect(overview.getByRole("link", { name: "Открыть проверку" })).toBeVisible();
  await overview.getByText("Экспорт источников", { exact: true }).click();
  const evidenceBundleDownload = page.waitForEvent("download");
  await overview.getByRole("link", { name: "Скачать локальный пакет источников" }).click();
  expect((await evidenceBundleDownload).suggestedFilename()).toBe("veylta-synthetic-evidence.tar");
  const portableProfileExportDownload = page.waitForEvent("download");
  await overview.getByRole("link", { name: "Скачать полный synthetic-экспорт профиля" }).click();
  expect((await portableProfileExportDownload).suggestedFilename()).toBe(
    "veylta-synthetic-profile.tar",
  );
  await uploadPdf(page, filename, bytes);

  await expect(page).toHaveURL(/\/docs\/[0-9a-f-]{36}\?upload=already_exists$/);
  expect(new URL(page.url()).pathname).toBe(new URL(firstDocumentUrl).pathname);
  await expect(
    page.getByText("Этот файл уже есть в архиве — открываем существующий документ."),
  ).toBeVisible();
});

test("a direct synthetic PNG is accepted, OCRed, and downloaded with its original type", async ({
  page,
}) => {
  await registerDemoFamily(page);
  const filename = `synthetic-lab-${crypto.randomUUID().slice(0, 8)}.png`;
  await uploadPdf(
    page,
    filename,
    createSyntheticLabImage(
      [
        "VEYLTA SYNTHETIC LAB REPORT v1",
        "SYNTHETIC TEST DATA - NOT FOR MEDICAL USE",
        "FACT|synthetic-analyte-a",
        "NAME|SYNTHETIC ANALYTE A",
        "VALUE|7.0",
        "UNIT|synthetic-unit",
        "RANGE|synthetic reference",
        "CONFIDENCE|0.60",
        "ISSUES|AMBIGUOUS_UNIT",
        "END",
      ],
      "png",
    ),
    "image/png",
  );

  await expect(page).toHaveURL(/\/docs\/[0-9a-f-]{36}$/);
  await expect(page.locator("#document-title")).toBeVisible();
  await expect(page.locator(".page-hero__meta")).toContainText("PNG");
  await expect(
    page.getByRole("heading", { name: "Черновые значения ждут проверки" }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Скачать" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(filename);
});

test("a restart command reuses its idempotency key after a transient browser failure", async ({
  page,
}) => {
  await registerDemoFamily(page);
  await uploadPdf(page, "retry-ui.pdf", syntheticLabBytes);
  await expect(page).toHaveURL(/\/[a-z0-9-]+\/docs\/[0-9a-f-]{36}$/);
  const documentId = page.url().match(/\/docs\/([0-9a-f-]{36})$/)?.[1];
  if (documentId === undefined) throw new Error("Expected a document URL");

  const idempotencyKeys: string[] = [];
  let restartAttempts = 0;
  await page.route("**/health-api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (request.method() === "GET" && pathname.endsWith("/processing")) {
      const processing =
        restartAttempts >= 2
          ? { state: "queued", updatedAt: "2026-08-12T12:00:01.000Z" }
          : {
              state: "failed",
              updatedAt: "2026-08-12T12:00:00.000Z",
              category: "extraction_failed",
              retryAllowed: true,
            };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          contractVersion: "document/v8",
          documentId,
          processing,
          activityRunId: "3f2c9a41-5c0b-4a1e-8f7d-2b6c9d0e1a34",
          activity:
            restartAttempts >= 2
              ? [{ code: "queued", attempt: 0, occurredAt: "2026-08-12T12:00:01.000Z" }]
              : [{ code: "failed", attempt: 3, occurredAt: "2026-08-12T12:00:00.000Z" }],
        }),
      });
      return;
    }

    if (request.method() === "POST" && pathname.endsWith("/processing/restart")) {
      const key = request.headers()["idempotency-key"];
      if (key !== undefined) idempotencyKeys.push(key);
      restartAttempts += 1;
      if (restartAttempts === 1) {
        await route.abort("failed");
        return;
      }
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          contractVersion: "document/v8",
          documentId,
          processing: { state: "queued", updatedAt: "2026-08-12T12:00:01.000Z" },
        }),
      });
      return;
    }

    await route.continue();
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Извлечение не завершилось" })).toBeVisible();

  const restart = page.getByRole("button", { name: "Перезапустить" });
  await restart.click();
  await expect(
    page.getByText("Не удалось запустить новый разбор. Предыдущий результат сохранён."),
  ).toBeVisible();
  await restart.click();

  await expect.poll(() => idempotencyKeys.length).toBe(2);
  expect(idempotencyKeys[0]).toEqual(idempotencyKeys[1]);
  await expect(page.getByRole("heading", { name: "Документ ожидает обработки" })).toBeVisible();
});

test("document archive searches summaries and deletion requires an explicit confirmation", async ({
  page,
}) => {
  const { profileUrl } = await registerDemoFamily(page);
  const filename = `search-delete-${crypto.randomUUID().slice(0, 8)}.pdf`;
  await uploadPdf(page, filename, syntheticLabBytes);
  await expect(
    page.getByRole("heading", { name: "Черновые значения ждут проверки" }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Документы", exact: true }).click();
  await expect(page).toHaveURL(`${profileUrl}/docs`);
  const archive = page.getByRole("region", { name: "Архив документов" });
  const search = archive.getByPlaceholder("Поиск по саммари и результатам");
  await search.fill("лабораторные результаты");
  await expect(archive.getByText(filename, { exact: true })).toBeVisible();
  await expect(archive.locator(".archive-list__summary")).toBeVisible();

  await archive
    .getByRole("link", { name: /Открыть (проверку|источник)/ })
    .last()
    .click();
  await page.getByRole("button", { name: "Удалить" }).click();
  const confirmation = page.getByRole("dialog", { name: "Удалить документ из Veylta?" });
  await expect(confirmation).toContainText("исчезнет из активного архива и поиска");
  await confirmation.getByRole("button", { name: "Отмена" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Удалить" }).click();
  await page
    .getByRole("dialog", { name: "Удалить документ из Veylta?" })
    .getByRole("button", { name: "Удалить документ" })
    .click();
  await expect(page).toHaveURL(`${profileUrl}/docs`);
  await expect(page.getByText(filename, { exact: true })).toHaveCount(0);
});

test("an invalid synthetic upload stays on the profile and explains the safe correction", async ({
  page,
}) => {
  const { profileUrl } = await registerDemoFamily(page);

  await uploadPdf(
    page,
    "not-really-a-pdf.pdf",
    Buffer.from("synthetic text without a PDF signature", "utf8"),
  );

  await expect(page).toHaveURL(profileUrl);
  await expect(page.locator(".form-error[role='alert']")).toHaveText(
    "Файл не похож на поддерживаемый PDF, PNG или JPEG. Проверьте формат и содержимое.",
  );
  await expect(page.getByText("Не загружайте реальные медицинские данные.")).toBeVisible();
});

test("another family session cannot see a document or its filename", async ({ page }) => {
  await registerDemoFamily(page);
  const privateFilename = `foreign-family-${crypto.randomUUID().slice(0, 8)}.pdf`;
  await uploadPdf(page, privateFilename, syntheticPdf("foreign-family-boundary"));
  await expect(page.getByRole("heading", { level: 1, name: privateFilename })).toBeVisible();
  const foreignDocumentUrl = page.url();

  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await registerDemoFamily(page);

  await page.goto(foreignDocumentUrl);
  await expect(page.getByRole("heading", { level: 1, name: "Профиль недоступен" })).toBeVisible();
  await expect(page.getByText(privateFilename)).toHaveCount(0);
});
