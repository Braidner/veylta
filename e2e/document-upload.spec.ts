import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

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
  await page.goto("/");
  await page.getByLabel("Имя владельца").fill(names.owner);
  await page.getByLabel("Название семьи").fill(names.family);
  await page.getByLabel("Имя профиля").fill(names.profile);
  await page.getByRole("button", { name: "Создать пространство" }).click();
  await expect(page).toHaveURL(/\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}$/);
  return { names, profileUrl: page.url() };
}

async function uploadPdf(
  page: Page,
  filename: string,
  buffer: Buffer,
  mimeType = "application/pdf",
) {
  await page
    .getByLabel("Синтетический PDF", { exact: true })
    .setInputFiles({ name: filename, mimeType, buffer });
  await page.getByRole("button", { name: "Загрузить PDF" }).click();
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
  await expect(page.getByRole("heading", { level: 2, name: filename })).toBeVisible();
  await expect(page.getByText("Исходник сохранён без изменений")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Черновые значения ждут проверки" }),
  ).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(firstDocumentUrl);
  await expect(page.getByRole("heading", { level: 2, name: filename })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Скачать исходный PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("document.pdf");

  await page.getByRole("link", { name: "Загрузить ещё документ" }).click();
  await expect(page).toHaveURL(profileUrl);
  await uploadPdf(page, filename, bytes);

  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  expect(page.url()).not.toBe(firstDocumentUrl);
  await expect(page.getByText("Возможный дубликат", { exact: true })).toBeVisible();
  await expect(
    page.getByText("SHA-256 совпадает с ранее загруженным документом этой семьи."),
  ).toBeVisible();
});

test("a retry command reuses its idempotency key after a transient browser failure", async ({
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
  let retryAttempts = 0;
  await page.route("**/health-api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (request.method() === "GET" && pathname.endsWith("/processing")) {
      const processing =
        retryAttempts >= 2
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
          contractVersion: "document/v3",
          documentId,
          processing,
        }),
      });
      return;
    }

    if (request.method() === "POST" && pathname.endsWith("/processing/retry")) {
      const key = request.headers()["idempotency-key"];
      if (key !== undefined) idempotencyKeys.push(key);
      retryAttempts += 1;
      if (retryAttempts === 1) {
        await route.abort("failed");
        return;
      }
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          contractVersion: "document/v3",
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

  const retry = page.getByRole("button", { name: "Повторить обработку" });
  await retry.click();
  await expect(
    page.getByText(
      "Не удалось запустить повторную обработку. Статус и исходный PDF не изменились.",
    ),
  ).toBeVisible();
  await retry.click();

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
    "Файл не похож на поддерживаемый PDF. Проверьте его формат и содержимое.",
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
