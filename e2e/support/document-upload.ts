import type { Page } from "@playwright/test";

export async function uploadSyntheticDocument(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  await page.locator(".profile-heading__upload").click();
  const dialog = page.getByRole("dialog", { name: "Загрузить синтетический документ" });
  await dialog.getByLabel("Синтетический документ", { exact: true }).setInputFiles(file);
  await dialog.getByRole("button", { name: "Загрузить исходник" }).click();
}
