import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { distinctSyntheticDocument, uploadSyntheticDocument } from "./support/document-upload";
import { createSyntheticFamily } from "./support/synthetic-family";

const syntheticLabFixture = new URL("../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url);

/** Above what the hop between the browser and the API used to admit. */
const LARGE_DOCUMENT_BYTES = 12 * 1024 * 1024;

function syntheticNames() {
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    owner: `Владелец ${suffix}`,
    family: `Семья ${suffix}`,
    profile: `Профиль ${suffix}`,
  };
}

/** The fixture padded to `byteSize` with PDF comment bytes, so the source stays a PDF. */
function paddedSyntheticPdf(fixture: Buffer, byteSize: number, identity: string): Buffer {
  const marked = distinctSyntheticDocument(fixture, identity);
  const padding = Buffer.alloc(Math.max(0, byteSize - marked.byteLength - 1), 0x25);
  return Buffer.concat([marked, padding, Buffer.from("\n", "utf8")]);
}

test("a document past the proxy's old body cap reaches the API and the archive", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const profileUrl = await createSyntheticFamily(page, syntheticNames());
  const filename = `large-source-${crypto.randomUUID().slice(0, 8)}.pdf`;
  const buffer = paddedSyntheticPdf(
    await readFile(syntheticLabFixture),
    LARGE_DOCUMENT_BYTES,
    filename,
  );
  expect(buffer.byteLength).toBeGreaterThan(10 * 1024 * 1024);

  await uploadSyntheticDocument(page, { name: filename, mimeType: "application/pdf", buffer });

  // The browser reaches the API only through the rewrite, and a truncated clone used to arrive
  // there as a broken multipart part — surfacing as «проверьте соединение», never as a size.
  await expect(page).toHaveURL(/\/[a-z0-9-]+\/docs\/[0-9a-f-]{36}$/);
  await expect(page.locator("#document-title")).toBeVisible();
  await expect(page.getByText(filename, { exact: false }).first()).toBeVisible();
  // The source arrived whole, so the run reads the same values it reads from the fixture.
  await expect(
    page.getByRole("heading", { name: "Черновые значения ждут проверки" }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Документы", exact: true }).click();
  await expect(page).toHaveURL(`${profileUrl}/docs`);
  const queue = page
    .getByRole("region", { name: "Архив документов" })
    .getByRole("region", { name: "Очередь" });
  await expect(
    queue.getByRole("link", { name: "Синтетические лабораторные результаты" }),
  ).toBeVisible();
  await expect(queue.getByRole("link", { name: "Проверить 2 значения" })).toBeVisible();
});
