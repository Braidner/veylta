import type { Page } from "@playwright/test";

export function distinctSyntheticDocument(buffer: Buffer, identity: string): Buffer {
  const safeIdentity = identity.replace(/[^a-zA-Z0-9._-]/g, "-");
  return Buffer.concat([buffer, Buffer.from(`\n% veylta-e2e-${safeIdentity}\n`, "utf8")]);
}

export async function uploadSyntheticDocument(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  // The documents tab leads with its own hero, so the upload entry point differs by tab.
  // Match on the accessible name: the heading button is labelled «Загрузить документ», the
  // hero button «Загрузить документы». A role locator auto-waits; counting first would race.
  await page
    .getByRole("button", { name: /^Загрузить документ/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Загрузить документы" });
  await dialog.getByLabel("Документы для Codex", { exact: true }).setInputFiles(file);
  await dialog
    .getByRole("checkbox", { name: /передать содержимое этих документов в Codex/i })
    .check();
  // The submit label counts the selection: «Загрузить 1 документ», «Загрузить 3 документа».
  await dialog.getByRole("button", { name: /^Загрузить \d+ документ/ }).click();
}
