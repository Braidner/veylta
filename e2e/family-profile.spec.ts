import { expect, type Page, test } from "@playwright/test";

function syntheticNames() {
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    owner: `Владелец ${suffix}`,
    family: `Семья ${suffix}`,
    profile: `Профиль ${suffix}`,
    dependent: `Подопечный ${suffix}`,
  };
}

async function registerDemoFamily(page: Page) {
  const names = syntheticNames();

  await page.goto("/");
  await page.getByLabel("Имя владельца").fill(names.owner);
  await page.getByLabel("Название семьи").fill(names.family);
  await page.getByLabel("Имя профиля").fill(names.profile);
  await page.getByRole("button", { name: "Создать пространство" }).click();

  await expect(page).toHaveURL(/\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: names.profile })).toBeVisible();
  await expect(page).toHaveTitle(`${names.profile} — Veylta`);

  return names;
}

test("a synthetic family session survives reload and keeps the active profile in the URL", async ({
  page,
}) => {
  const names = await registerDemoFamily(page);
  const ownerProfileUrl = page.url();

  await expect(page.getByText(names.family, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Активный профиль")).toHaveValue(/^[0-9a-f-]{36}$/);

  await page.reload();

  await expect(page).toHaveURL(ownerProfileUrl);
  await expect(page.getByRole("heading", { level: 1, name: names.profile })).toBeVisible();

  await page.getByRole("button", { name: "Добавить профиль" }).click();
  await page.getByLabel("Имя нового профиля").fill(names.dependent);
  await page.getByRole("button", { name: "Создать профиль" }).click();

  await expect(page).toHaveURL(/\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: names.dependent })).toBeVisible();
  await expect(page).toHaveTitle(`${names.dependent} — Veylta`);
  await expect(page.getByLabel("Активный профиль")).toHaveValue(/^[0-9a-f-]{36}$/);

  await page.getByLabel("Активный профиль").selectOption({ label: names.profile });
  await expect(page).toHaveURL(ownerProfileUrl);
  await expect(page.getByRole("heading", { level: 1, name: names.profile })).toBeVisible();
  await expect(page).toHaveTitle(`${names.profile} — Veylta`);

  await page.getByRole("button", { name: "Выйти" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Создайте семейное пространство",
  );
});

test("an owner can inspect the payload-free family activity log", async ({ page }) => {
  await registerDemoFamily(page);

  const auditLog = page.getByRole("region", { name: "Журнал действий семьи" });
  await expect(auditLog).toBeVisible();
  await expect(auditLog.getByRole("heading", { name: "Журнал действий семьи" })).toBeVisible();
  await expect(auditLog.getByText("Создана семья")).toBeVisible();
  await expect(auditLog.getByText("Создан профиль")).toBeVisible();
  await expect(auditLog).not.toContainText("metadata");
  await expect(auditLog).not.toContainText("correlation");
});

test("an owner can issue a one-time local adult invitation with no access to another profile", async ({
  page,
}) => {
  const names = await registerDemoFamily(page);
  const ownerProfile = page.url();

  const invitation = page.getByRole("region", { name: "Пригласить взрослого" });
  await expect(invitation).toBeVisible();
  await invitation.getByRole("button", { name: "Создать одноразовый код" }).click();
  const code = await invitation.locator("code").textContent();
  expect(code).toMatch(/^vi_[A-Za-z0-9_-]{43}$/);

  await page.getByRole("button", { name: "Выйти" }).click();
  await page.getByRole("button", { name: "У меня есть код приглашения" }).click();
  await page.getByLabel("Одноразовый код").fill(code ?? "");
  await page.getByLabel("Ваше имя").fill(`Участник ${crypto.randomUUID().slice(0, 8)}`);
  const adultProfile = `Личный профиль ${crypto.randomUUID().slice(0, 8)}`;
  await page.getByLabel("Имя вашего профиля").fill(adultProfile);
  await page.getByRole("button", { name: "Присоединиться к семье" }).click();

  await expect(page).toHaveURL(/\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: adultProfile })).toBeVisible();
  await expect(page.getByText("Участник пространства:", { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: "Пригласить взрослого" })).toHaveCount(0);

  await page.goto(ownerProfile);
  await expect(page.getByRole("heading", { level: 1, name: "Профиль недоступен" })).toBeVisible();
  await expect(page.getByText(names.profile, { exact: true })).toHaveCount(0);
});

test("an unavailable active profile does not disclose profile data", async ({ page }) => {
  const names = await registerDemoFamily(page);

  await page.goto(
    "/families/00000000-0000-4000-8000-000000000000/profiles/00000000-0000-4000-8000-000000000000",
  );

  await expect(page.getByRole("heading", { level: 1, name: "Профиль недоступен" })).toBeVisible();
  await expect(page.getByText(names.profile)).toHaveCount(0);
  await page.getByRole("link", { name: "Открыть доступный профиль" }).click();
  await expect(page.getByRole("heading", { level: 1, name: names.profile })).toBeVisible();
});
