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

test("a synthetic report is extracted, survives reload, downloads, and reports a family duplicate", async ({
  page,
}) => {
  const { profileUrl } = await registerDemoFamily(page);
  const filename = `synthetic-lab-${crypto.randomUUID().slice(0, 8)}.pdf`;
  const bytes = syntheticLabBytes;

  await uploadPdf(page, filename, bytes);

  await expect(page).toHaveURL(
    /\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}$/,
  );
  const firstDocumentUrl = page.url();
  await expect(page.getByText(filename, { exact: false })).toBeVisible();
  await expect(page.getByText("Исходник сохранён без изменений")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Черновые значения ждут проверки" }),
  ).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(firstDocumentUrl);
  await expect(
    page.getByRole("heading", { level: 2, name: "Синтетические лабораторные результаты" }),
  ).toBeVisible();
  await expect(page.getByText(filename, { exact: false })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Скачать исходный PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("document.pdf");

  await page.getByRole("link", { name: "Открыть документы" }).click();
  await expect(page).toHaveURL(`${profileUrl}?tab=documents`);
  const overview = page.getByRole("region", { name: "Архив документов" });
  await expect(
    overview
      .getByRole("region", { name: "Проверка исходников" })
      .getByText(filename, { exact: true }),
  ).toBeVisible();
  await expect(overview.getByText("2 значения ждут решения")).toBeVisible();
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

  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  expect(page.url()).not.toBe(firstDocumentUrl);
  await expect(page.getByText("Возможный дубликат", { exact: true })).toBeVisible();
  await expect(
    page.getByText("SHA-256 совпадает с ранее загруженным документом этой семьи."),
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

  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 2, name: filename })).toBeVisible();
  await expect(page.getByText(/^PNG ·/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Черновые значения ждут проверки" }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Скачать исходный PNG" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("document.png");
});

test("a restart command reuses its idempotency key after a transient browser failure", async ({
  page,
}) => {
  await registerDemoFamily(page);
  await uploadPdf(page, "retry-ui.pdf", syntheticLabBytes);
  await expect(page).toHaveURL(
    /\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}$/,
  );
  const documentId = page.url().match(/\/documents\/([0-9a-f-]{36})$/)?.[1];
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
          contractVersion: "document/v4",
          documentId,
          processing,
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
          contractVersion: "document/v4",
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

  const restart = page.getByRole("button", { name: "Перезапустить разбор" });
  await restart.click();
  await expect(
    page.getByText("Не удалось перезапустить разбор. Исходник и прежние результаты сохранены."),
  ).toBeVisible();
  await restart.click();

  await expect.poll(() => idempotencyKeys.length).toBe(2);
  expect(idempotencyKeys[0]).toEqual(idempotencyKeys[1]);
  await expect(page.getByRole("heading", { name: "Документ ожидает обработки" })).toBeVisible();
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
  await expect(page.getByRole("heading", { level: 2, name: privateFilename })).toBeVisible();
  const foreignDocumentUrl = page.url();

  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page).toHaveURL(/\/$/);
  await registerDemoFamily(page);

  await page.goto(foreignDocumentUrl);
  await expect(page.getByRole("heading", { level: 1, name: "Профиль недоступен" })).toBeVisible();
  await expect(page.getByText(privateFilename)).toHaveCount(0);
});
