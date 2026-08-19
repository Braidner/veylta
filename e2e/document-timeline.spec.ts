import { expect, test } from "@playwright/test";
import { confirmResult, correctResult, openReview } from "./support/review";

// Upload → the document sits in the queue → both values decided → it appears in the timeline under
// its effective date («по дате загрузки» for the lab fixture, which carries no date of its own) →
// the person corrects the date → the node moves to May.

test("a document waits in the queue, joins the timeline once reviewed, and moves when its date is corrected", async ({
  page,
}) => {
  await openReview(page);
  const documentUrl = page.url();
  const profileUrl = documentUrl.replace(/\/docs\/[0-9a-f-]{36}$/, "");

  await page.goto(`${profileUrl}/docs`);
  const queue = page.getByRole("region", { name: "Очередь" });
  // The row names the document by Codex's title, falling back to the filename until it arrives.
  await expect(
    queue.getByRole("link", { name: /Синтетические лабораторные результаты|review-.*\.pdf/ }),
  ).toBeVisible();
  await expect(queue.getByRole("link", { name: "Проверить 2 значения" })).toBeVisible();
  await expect(page.getByTestId("documents-hero")).toContainText(
    "1 всего · 1 в очереди · 1 ждёт проверки",
  );
  await expect(page.locator(".document-timeline__empty")).toBeVisible();

  await page.goto(documentUrl);
  await confirmResult(page, "synthetic-analyte-a");
  await correctResult(page, "synthetic-analyte-b", { name: "ТТГ", value: "6.8", unit: "мМЕ/л" });

  await page.goto(`${profileUrl}/docs`);
  await expect(page.locator(".document-queue__empty")).toHaveText("Очередь пуста");
  await expect(page.getByTestId("documents-hero")).toContainText(
    "1 всего · 0 в очереди · 0 ждут проверки",
  );
  const node = page.locator(".document-timeline__node");
  await expect(node).toHaveCount(1);
  await expect(node).toContainText("по дате загрузки");
  await expect(node).toContainText("подтверждено 2");
  const today = new Date();
  const thisMonth = new Intl.DateTimeFormat("ru-RU", { month: "long", timeZone: "UTC" }).format(
    today,
  );
  await expect(page.locator(".document-timeline__month-title").first()).toContainText(
    new RegExp(
      `^${thisMonth.charAt(0).toUpperCase()}${thisMonth.slice(1)} ${today.getUTCFullYear()}$`,
    ),
  );

  await node.getByRole("button", { name: "Исправить дату" }).click();
  const editor = page.getByRole("form", { name: "Исправление даты документа" });
  await editor.getByLabel("Дата документа").fill("2026-05-14");
  await editor.getByRole("button", { name: "Сохранить дату" }).click();
  await expect(page.locator(".document-timeline__month-title").first()).toHaveText("Май 2026");
  await expect(node).toContainText("14 мая 2026 г.");
  await expect(node).toContainText("дата исправлена");

  await page.reload();
  await expect(page.locator(".document-timeline__month-title").first()).toHaveText("Май 2026");

  // Clearing returns the upload day.
  await page
    .locator(".document-timeline__node")
    .getByRole("button", { name: "Исправить дату" })
    .click();
  await page
    .getByRole("form", { name: "Исправление даты документа" })
    .getByRole("button", { name: "Сбросить" })
    .click();
  await expect(page.locator(".document-timeline__node")).toContainText("по дате загрузки");
});
