import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { distinctSyntheticDocument } from "./support/document-upload";
import { createSyntheticFamily } from "./support/synthetic-family";

const fixtureUrl = new URL("../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url);

test("desktop dashboard matches the full-width reference composition", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await createSyntheticFamily(page, {
    owner: "Dashboard Owner",
    family: "Dashboard Family",
    profile: "Иван",
  });

  await expect(page.getByRole("heading", { level: 1, name: "Иван" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Поиск по архиву" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Загрузить документ" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Помощники" })).toBeVisible();
  await expect(page.locator("[data-assistant]")).toHaveCount(3);
  await expect(page.locator('[data-assistant="physician"]')).toContainText(
    "ИИ-врач · второе мнение",
  );
  await expect(page.locator('[data-assistant="nutrition"]')).toContainText("недостаточно данных");
  await expect(page.locator('[data-assistant="movement"]')).toContainText("ограничения");
  await expect(page.getByText("Не заменяют специалиста")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Сигналы здоровья" })).toBeVisible();
  await expect(page.getByText("Без общего балла")).toBeVisible();
  await expect(page.getByText("Ждёт проверки")).toBeVisible();
  await expect(page.getByText("Отмечено источником")).toBeVisible();
  await expect(page.getByText("индекс здоровья", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Последний документ" })).toBeVisible();
  await expect(
    page.locator(".dashboard-plan").getByRole("heading", { name: "План заботы" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Добавить источник" })).toBeVisible();

  const tabs = page.getByRole("tablist", { name: "Основные разделы профиля" });
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "Обзор", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tabpanel", { name: "Обзор" })).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Документы" })).toHaveCount(0);

  const viewportWidth = page.viewportSize()?.width ?? 0;
  const headerBox = await page.locator(".workspace-bar").boundingBox();
  const shellBox = await page.locator(".profile-shell").boundingBox();
  const assistantsBox = await page.locator(".assistant-hub").boundingBox();
  const signalsBox = await page.locator(".health-signals").boundingBox();
  const documentBox = await page.locator(".dashboard-documents").boundingBox();
  const planBox = await page.locator(".dashboard-plan").boundingBox();

  expect(headerBox).not.toBeNull();
  expect(shellBox).not.toBeNull();
  expect(assistantsBox).not.toBeNull();
  expect(signalsBox).not.toBeNull();
  expect(documentBox).not.toBeNull();
  expect(planBox).not.toBeNull();
  expect(headerBox?.x).toBeLessThanOrEqual(1);
  expect(headerBox?.width).toBeGreaterThanOrEqual(viewportWidth - 1);
  expect(shellBox?.x).toBeLessThanOrEqual(1);
  expect(shellBox?.width).toBeGreaterThanOrEqual(viewportWidth - 1);
  expect(signalsBox?.x ?? 0).toBeGreaterThan((assistantsBox?.x ?? 0) + 100);
  expect(documentBox?.y ?? 0).toBeGreaterThan((signalsBox?.y ?? 0) + 100);
  expect(planBox?.x ?? 0).toBeGreaterThan((documentBox?.x ?? 0) + 100);
  expect(planBox?.y).toBe(documentBox?.y);

  const viewportContract = await page.evaluate(() => ({
    viewport: window.innerHeight,
    page: document.documentElement.scrollHeight,
    body: document.body.scrollHeight,
  }));
  expect(viewportContract.page).toBeLessThanOrEqual(viewportContract.viewport + 1);
  expect(viewportContract.body).toBeLessThanOrEqual(viewportContract.viewport + 1);

  await tabs.getByRole("tab", { name: "Документы", exact: true }).click();
  await expect(page).toHaveURL(/\?tab=documents$/);
  await expect(page.getByRole("tabpanel", { name: "Документы" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Документы профиля" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Помощники" })).toHaveCount(0);

  await tabs.getByRole("tab", { name: "История", exact: true }).click();
  await expect(page).toHaveURL(/\?tab=history$/);
  await expect(page.getByRole("tabpanel", { name: "История" })).toBeVisible();
  await expect(page.getByRole("region", { name: "История подтверждённых значений" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Документы профиля" })).toHaveCount(0);

  await tabs.getByRole("tab", { name: "План", exact: true }).click();
  await expect(page).toHaveURL(/\?tab=plan$/);
  await expect(page.getByRole("tabpanel", { name: "План" })).toBeVisible();
  await expect(page.getByRole("region", { name: "План заботы" })).toBeVisible();

  await tabs.getByRole("tab", { name: "Обзор", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\?tab=documents$/);
  await expect(tabs.getByRole("tab", { name: "Документы", exact: true })).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("tablist", { name: "Основные разделы профиля" })).toBeVisible();
  await expect(
    page
      .getByRole("tablist", { name: "Основные разделы профиля" })
      .getByRole("tab", { name: "План", exact: true }),
  ).toBeVisible();
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflows).toBe(false);
});

test("upload opens a keyboard-safe Codex batch dialog", async ({ page }) => {
  await createSyntheticFamily(page, {
    owner: "Upload Owner",
    family: "Upload Family",
    profile: "Анна",
  });

  await page.getByRole("button", { name: "Загрузить документ" }).click();
  const dialog = page.getByRole("dialog", { name: "Загрузить документы" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Перетащите файлы сюда")).toBeVisible();
  await expect(dialog.getByText(/Codex сам определит тип/)).toBeVisible();
  await expect(dialog.getByLabel("Документы для Codex")).toHaveAttribute("multiple", "");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Загрузить документ" }).click();
  const fixture = await readFile(fixtureUrl);
  const files = {
    first: Array.from(distinctSyntheticDocument(fixture, "dashboard-a")),
    second: Array.from(distinctSyntheticDocument(fixture, "dashboard-b")),
  };
  await dialog.locator(".upload-dropzone").evaluate((dropzone, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([Uint8Array.from(bytes.first)], "synthetic-a.pdf", {
        type: "application/pdf",
      }),
    );
    transfer.items.add(
      new File([Uint8Array.from(bytes.second)], "synthetic-b.pdf", {
        type: "application/pdf",
      }),
    );
    dropzone.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer: transfer }));
    dropzone.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
  }, files);
  await expect(dialog.getByText("synthetic-a.pdf", { exact: true })).toBeVisible();
  await expect(dialog.getByText("synthetic-b.pdf", { exact: true })).toBeVisible();
  const submit = dialog.getByRole("button", { name: "Загрузить 2 документа" });
  await expect(submit).toBeDisabled();
  await dialog
    .getByRole("checkbox", { name: /передать содержимое этих документов в Codex/i })
    .check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page).toHaveURL(/\?tab=documents$/);
  // One list; freshly extracted sources await review, so their verb is «Открыть проверку».
  await expect(page.getByRole("region", { name: "Документы", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("link", { name: /^Открыть (проверку|источник) / })).toHaveCount(2, {
    timeout: 15_000,
  });
});
