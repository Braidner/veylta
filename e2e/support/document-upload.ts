import type { Page } from "@playwright/test";

export async function uploadSyntheticDocument(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  await page.locator(".profile-heading__upload").click();
  const dialog = page.getByRole("dialog", { name: "Загрузить документы" });
  await dialog.getByLabel("Документы для Codex", { exact: true }).setInputFiles(file);
  await dialog
    .getByRole("checkbox", { name: /передать содержимое этих документов в Codex/i })
    .check();
  await dialog.getByRole("button", { name: "Загрузить документ" }).click();
}
