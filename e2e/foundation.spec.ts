import { expect, test } from "@playwright/test";

test("the runnable foundation exposes web, API, worker, and SQLite readiness", async ({
  page,
  request,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Создайте семейное пространство",
  );
  await expect(page.getByText("API и база данных готовы")).toBeVisible();
  await expect(page.getByLabel("Электронная почта")).toHaveCount(0);

  const worker = await request.get("http://127.0.0.1:4302/readyz");
  expect(worker.ok()).toBe(true);
  await expect(worker.json()).resolves.toMatchObject({ status: "ok", service: "worker" });
});

test("the synthetic-only safety marker remains fully visible on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const marker = page.getByText("Только синтетика", { exact: true });
  await expect(marker).toBeVisible();
  await expect
    .poll(() => marker.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
});
