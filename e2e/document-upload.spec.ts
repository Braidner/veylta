import { expect, type Page, test } from "@playwright/test";

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
    `%PDF-1.7\n% Family Health synthetic fixture\n1 0 obj\n<< /Type /Catalog /Label (${label}) >>\nendobj\n%%EOF\n`,
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

test("a synthetic PDF survives reload, downloads, and reports a family duplicate", async ({
  page,
}) => {
  const { profileUrl } = await registerDemoFamily(page);
  const filename = `synthetic-lab-${crypto.randomUUID().slice(0, 8)}.pdf`;
  const bytes = syntheticPdf("same-family-deduplication");

  await uploadPdf(page, filename, bytes);

  await expect(page).toHaveURL(
    /\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}$/,
  );
  const firstDocumentUrl = page.url();
  await expect(page.getByRole("heading", { level: 2, name: filename })).toBeVisible();
  await expect(page.getByText("Исходник сохранён без изменений")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Извлечение не запущено" })).toBeVisible();

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
