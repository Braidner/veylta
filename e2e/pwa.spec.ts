import { expect, test } from "@playwright/test";

test("Veylta exposes an installable PWA manifest without medical-data shortcuts", async ({
  page,
  request,
}) => {
  await page.goto("/");

  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveAttribute("href", "/manifest.webmanifest");

  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    name: "Veylta",
    short_name: "Veylta",
    display: "standalone",
    start_url: "/",
    scope: "/",
    icons: [
      { src: "/icons/veylta-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/veylta-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/veylta-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  });
});

test("the service worker offers only a safe offline shell", async ({ context, page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  const cachedRequests = await page.evaluate(async () => {
    const requests = await Promise.all(
      (await caches.keys()).map(async (name) => (await caches.open(name)).keys()),
    );
    return requests.flat().map((request) => new URL(request.url).pathname);
  });
  expect(cachedRequests).toContain("/offline.html");
  expect(
    cachedRequests.some((path) => path.includes("health-api") || path.includes("documents")),
  ).toBe(false);

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole("heading", { name: "Veylta сейчас офлайн" })).toBeVisible();
  await expect(page.getByText("Медицинские данные не сохранены в кэше браузера")).toBeVisible();
});
