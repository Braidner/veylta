import { expect, test } from "@playwright/test";

test("initializes and reopens one user-owned vault directory without the API", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: () => navigator.storage.getDirectory(),
    });
  });
  const vaultRequests: string[] = [];
  await page.route("**/health-api/**", async (route) => {
    vaultRequests.push(route.request().url());
    await route.continue();
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Подключите личную папку" })).toBeVisible();
  await page.getByRole("button", { name: "Выбрать Veylta Vault" }).click();

  await expect(page.getByRole("heading", { name: "Личная папка подключена" })).toBeVisible();
  await expect(page.getByText("veylta-vault/v1", { exact: true })).toBeVisible();

  const onDisk = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const manifestHandle = await root.getFileHandle("vault.json");
    const manifest = JSON.parse(await (await manifestHandle.getFile()).text()) as {
      contractVersion: string;
      vaultId: string;
    };
    const directoryNames: string[] = [];
    for await (const name of root.keys()) directoryNames.push(name);
    return { manifest, directoryNames: directoryNames.sort() };
  });
  expect(onDisk.manifest.contractVersion).toBe("veylta-vault/v1");
  expect(onDisk.manifest.vaultId).toMatch(/^[0-9a-f-]{36}$/);
  expect(onDisk.directoryNames).toEqual(["agent", "audit", "profiles", "vault.json"]);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Личная папка подключена" })).toBeVisible();
  await expect(page.getByTitle(onDisk.manifest.vaultId)).toBeVisible();

  expect(vaultRequests.every((url) => !url.includes("vault.json"))).toBe(true);
});
