import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { distinctSyntheticDocument, uploadSyntheticDocument } from "./support/document-upload";
import { registerDemoFamily, resultCard } from "./support/review";

const imagePageBytes = await readFile(
  new URL("../fixtures/veylta-synthetic-image-page-report.pdf", import.meta.url),
);

test("a picture page inside a text PDF is read, said so, and its values reach review", async ({
  page,
}) => {
  await registerDemoFamily(page);
  const filename = `image-page-${crypto.randomUUID().slice(0, 8)}.pdf`;
  await uploadSyntheticDocument(page, {
    name: filename,
    mimeType: "application/pdf",
    buffer: distinctSyntheticDocument(imagePageBytes, filename),
  });

  await expect(page).toHaveURL(/\/[a-z0-9-]+\/docs\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Результаты исследования" })).toBeVisible();

  // The rail says how the two pages were read: page 1 from the text layer, page 2 as a picture.
  const pages = page.getByTestId("document-pages-card");
  await expect(pages.getByRole("heading", { name: "Страницы" })).toBeVisible();
  await expect(pages).toContainText("2 страницы · текстовый слой и разбор изображения");
  const note = pages.locator("li[data-page-reading='read']");
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("Страница 2 · Рисунок прочитан");
  await expect(note).toContainText("расшифровал её в текст");
  await expect(pages.locator("li[data-page-reading='unread']")).toHaveCount(0);

  // The picture page's own value waits for the person beside the ones printed as text.
  await expect(resultCard(page, "synthetic-analyte-a")).toBeVisible();
  await expect(resultCard(page, "synthetic-analyte-b")).toBeVisible();
  const fromPicture = resultCard(page, "synthetic-analyte-a-page-2");
  await expect(fromPicture).toBeVisible();
  await fromPicture.click();
  const source = page.getByTestId("document-review-source");
  await expect(source).toContainText("Страница 2");
  await expect(source.getByText("FACT|synthetic-analyte-a-page-2")).toBeVisible();
});
