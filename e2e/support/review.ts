import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page } from "@playwright/test";
import { distinctSyntheticDocument, uploadSyntheticDocument } from "./document-upload";
import { createSyntheticFamily } from "./synthetic-family";

// The review workspace as the specs address it: a fresh family with one processed synthetic
// report, and locators for the parts a reviewer works with.

const syntheticLabFixture = new URL("../../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url);
const syntheticLabBytes = await readFile(syntheticLabFixture);

export function syntheticNames() {
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    owner: `Владелец review ${suffix}`,
    family: `Семья review ${suffix}`,
    profile: `Профиль review ${suffix}`,
  };
}

export async function registerDemoFamily(page: Page) {
  const names = syntheticNames();
  await createSyntheticFamily(page, names);
  return names;
}

export async function openReview(page: Page) {
  const names = await registerDemoFamily(page);
  const filename = `review-${crypto.randomUUID().slice(0, 8)}.pdf`;
  await uploadSyntheticDocument(page, {
    name: filename,
    mimeType: "application/pdf",
    buffer: distinctSyntheticDocument(syntheticLabBytes, filename),
  });
  await expect(page).toHaveURL(
    /\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}$/,
  );
  await expect(page.getByRole("heading", { name: "Результаты исследования" })).toBeVisible();
  return names;
}

export function resultCard(page: Page, factKey: string): Locator {
  return page.getByTestId(`document-result-card-${factKey}`);
}

export function reviewWorkspace(page: Page): Locator {
  return page.getByTestId("document-review-workspace");
}

/** The journal carries the moment the decision was written — the real clock, not a fixture date. */
export async function expectDecisionTimeJustNow(time: Locator): Promise<void> {
  await expect(time).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const datetime = await time.getAttribute("datetime");
  expect(Math.abs(Date.now() - Date.parse(datetime ?? ""))).toBeLessThan(5 * 60_000);
}
