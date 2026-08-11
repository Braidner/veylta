import { expect, test } from "@playwright/test";

test("the runnable foundation exposes web, API, worker, and PostgreSQL readiness", async ({
  page,
  request,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Источник остаётся рядом");
  await expect(page.getByText("API и база данных готовы")).toBeVisible();

  const worker = await request.get("http://127.0.0.1:4302/readyz");
  expect(worker.ok()).toBe(true);
  await expect(worker.json()).resolves.toMatchObject({ status: "ok", service: "worker" });
});
