import { expect, type Page, test } from "@playwright/test";
import { registerDemoFamily } from "./support/review";
import { webOrigin } from "./support/synthetic-family";
import { profileHandleUrl } from "./support/urls";

// A person's page lives at /<handle>; /login is the only door; the owner renames the address and
// the page moves with it; an old /families/… link still lands on the same person and surface.

test("the profile lives at its handle, the owner renames it, and old links follow", async ({
  page,
}) => {
  const names = await registerDemoFamily(page);
  await expect(page).toHaveURL(profileHandleUrl);
  const handle = new URL(page.url()).pathname.slice(1);
  expect(handle).not.toBe("login");

  // The old address shapes point at the same person and the same surface.
  const session = await page.request.get("/health-api/v1/session");
  const body = (await session.json()) as {
    families: Array<{ id: string; profiles: Array<{ id: string; handle: string }> }>;
  };
  const family = body.families[0];
  const profile = family?.profiles[0];
  if (family === undefined || profile === undefined) throw new Error("the session has no profile");
  expect(profile.handle).toBe(handle);
  await page.goto(`/families/${family.id}/profiles/${profile.id}?tab=dossier`);
  await expect(page).toHaveURL(new RegExp(`/${handle}/dossier$`));
  await expect(page.getByTestId("dossier-passport")).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/${handle}$`));

  // Renaming in settings moves the page; the old address stops opening.
  await page.getByTestId("settings-gear").click();
  await expect(page).toHaveURL(new RegExp(`/${handle}/settings$`));
  const field = page.getByLabel("Адрес");
  await field.fill("login");
  await expect(page.getByText("Это слово занято системой.")).toBeVisible();
  await field.fill("Anna-Test");
  await page.getByRole("button", { name: "Сохранить адрес" }).click();
  await expect(page).toHaveURL(/\/anna-test\/settings$/);
  await page.goto("/anna-test");
  await expect(page.getByRole("heading", { level: 1, name: names.profile })).toBeVisible();
  await page.goto(`/${handle}`);
  await expect(page.getByRole("heading", { level: 1, name: "Профиль недоступен" })).toBeVisible();

  // Signed out, every page is the door.
  const signOut = await page.request.delete("/health-api/v1/session", {
    headers: { origin: webOrigin },
  });
  expect(signOut.status()).toBe(204);
  await page.goto("/anna-test/docs");
  await expect(page).toHaveURL(/\/login$/);
  // Which door depends on whether this stand already has an administrator; both live at /login.
  await expect(
    page.getByRole("heading", { level: 1, name: /Настройте домашнюю Veylta|Войдите в Veylta/ }),
  ).toBeVisible();
});

/**
 * Watches the mounted shell from inside the page: the flag survives only a client-side
 * navigation, and the observer records the shell's own loading copy if it ever comes back.
 */
async function watchMountedShell(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = { loadingSeen: false };
    (window as unknown as { veyltaShellWatch?: typeof state }).veyltaShellWatch = state;
    const read = () => {
      if (document.body.textContent?.includes("Открываем семейное пространство…") === true) {
        state.loadingSeen = true;
      }
    };
    read();
    new MutationObserver(read).observe(document.body, {
      characterData: true,
      childList: true,
      subtree: true,
    });
  });
}

/** The watcher's record, or null when a full page load wiped it — which is a remount. */
async function mountedShellReport(page: Page): Promise<{ loadingSeen: boolean } | null> {
  return page.evaluate(
    () =>
      (window as unknown as { veyltaShellWatch?: { loadingSeen: boolean } }).veyltaShellWatch ??
      null,
  );
}

test("one mounted shell serves every tab of a person", async ({ page }) => {
  const names = await registerDemoFamily(page);
  await expect(page.getByRole("heading", { level: 1, name: names.profile })).toBeVisible();
  const handle = new URL(page.url()).pathname.slice(1);

  // The stand runs `next dev`, so each route compiles on its first request; warm them before
  // measuring, or the first click would time the compiler rather than the shell.
  for (const segment of ["docs", "history", "dossier"]) {
    await page.goto(`/${handle}/${segment}`);
  }
  await page.goto(`/${handle}`);
  await expect(page.getByRole("heading", { level: 1, name: names.profile })).toBeVisible();

  let sessionReads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/health-api/v1/session") sessionReads += 1;
  });
  await watchMountedShell(page);

  const tabs = page.getByRole("tablist", { name: "Основные разделы профиля" });
  await tabs.getByRole("tab", { name: "Документы", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${handle}/docs$`));
  await expect(page.getByRole("tabpanel", { name: "Документы" })).toBeVisible();

  await tabs.getByRole("tab", { name: "История", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${handle}/history$`));
  await expect(page.getByRole("tabpanel", { name: "История" })).toBeVisible();

  await tabs.getByRole("tab", { name: "Досье", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${handle}/dossier$`));
  await expect(page.getByTestId("dossier-passport")).toBeVisible();

  // One mount across three tabs: no second session read, and no interstitial between them.
  expect(sessionReads).toBe(0);
  expect(await mountedShellReport(page)).toEqual({ loadingSeen: false });
});
