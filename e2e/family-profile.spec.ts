import { type Browser, expect, type Page, test } from "@playwright/test";

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

  const invitation = page.getByRole("region", { name: "Пригласить участника" });
  await expect(invitation).toBeVisible();
  await invitation.getByRole("button", { name: "Создать код для взрослого" }).click();
  const code = await invitation.locator("code").textContent();
  expect(code).toMatch(/^vi_[A-Za-z0-9_-]{43}$/);

  await page.getByRole("button", { name: "Выйти" }).click();
  await page.getByRole("button", { name: "У меня есть код приглашения" }).click();
  await page.getByLabel("Одноразовый код").fill(code ?? "");
  await page.getByLabel("Ваше имя").fill(`Участник ${crypto.randomUUID().slice(0, 8)}`);
  const adultProfile = `Личный профиль ${crypto.randomUUID().slice(0, 8)}`;
  await page.getByLabel("Имя вашего профиля, если приглашены как взрослый").fill(adultProfile);
  await page.getByRole("button", { name: "Присоединиться к семье" }).click();

  await expect(page).toHaveURL(/\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: adultProfile })).toBeVisible();
  await expect(page.getByText("Участник пространства:", { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: "Пригласить участника" })).toHaveCount(0);

  await page.goto(ownerProfile);
  await expect(page.getByRole("heading", { level: 1, name: "Профиль недоступен" })).toBeVisible();
  await expect(page.getByText(names.profile, { exact: true })).toHaveCount(0);
});

test("an owner grants and revokes read-only access to a profile for an invited adult", async ({
  browser,
}: {
  browser: Browser;
}) => {
  const ownerContext = await browser.newContext();
  const adultContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const adultPage = await adultContext.newPage();

  try {
    const names = await registerDemoFamily(ownerPage);
    const ownerProfileUrl = ownerPage.url();
    const invitation = ownerPage.getByRole("region", { name: "Пригласить участника" });
    await invitation.getByRole("button", { name: "Создать код для взрослого" }).click();
    const code = await invitation.locator("code").textContent();
    expect(code).toMatch(/^vi_[A-Za-z0-9_-]{43}$/);

    await adultPage.goto("/");
    await adultPage.getByRole("button", { name: "У меня есть код приглашения" }).click();
    await adultPage.getByLabel("Одноразовый код").fill(code ?? "");
    await adultPage.getByLabel("Ваше имя").fill(`Читатель ${crypto.randomUUID().slice(0, 8)}`);
    const adultProfile = `Личный профиль ${crypto.randomUUID().slice(0, 8)}`;
    await adultPage
      .getByLabel("Имя вашего профиля, если приглашены как взрослый")
      .fill(adultProfile);
    await adultPage.getByRole("button", { name: "Присоединиться к семье" }).click();
    await expect(adultPage.getByRole("heading", { level: 1, name: adultProfile })).toBeVisible();

    await ownerPage.reload();
    const consent = ownerPage.getByRole("region", { name: "Доступ к этому профилю" });
    await expect(consent).toBeVisible();
    await consent.getByRole("button", { name: "Разрешить чтение" }).click();
    await expect(consent.getByText("Только чтение", { exact: true })).toBeVisible();
    await expect(consent.getByRole("button", { name: "Отозвать доступ" })).toBeVisible();

    await adultPage.goto(ownerProfileUrl);
    await expect(adultPage.getByRole("heading", { level: 1, name: names.profile })).toBeVisible();
    await expect(adultPage.getByText("Доступ по согласию: только чтение")).toBeVisible();
    await expect(
      adultPage.getByRole("heading", { level: 2, name: "Доступ выдан владельцем профиля" }),
    ).toBeVisible();
    await expect(adultPage.getByLabel("Синтетический документ", { exact: true })).toHaveCount(0);

    await consent.getByRole("button", { name: "Отозвать доступ" }).click();
    await expect(consent.getByText("Нет доступа", { exact: true })).toBeVisible();

    await adultPage.reload();
    await expect(
      adultPage.getByRole("heading", { level: 1, name: "Профиль недоступен" }),
    ).toBeVisible();
  } finally {
    await ownerContext.close();
    await adultContext.close();
  }
});

test("a caregiver starts without a profile and sees only a profile explicitly shared by the owner", async ({
  browser,
}: {
  browser: Browser;
}) => {
  const ownerContext = await browser.newContext();
  const caregiverContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const caregiverPage = await caregiverContext.newPage();

  try {
    const names = await registerDemoFamily(ownerPage);
    await ownerPage.getByRole("button", { name: "Добавить профиль" }).click();
    await ownerPage.getByLabel("Имя нового профиля").fill(names.dependent);
    await ownerPage.getByRole("button", { name: "Создать профиль" }).click();
    await expect(ownerPage).toHaveURL(/\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}$/);
    await expect(ownerPage.getByRole("heading", { level: 1, name: names.dependent })).toBeVisible();
    const sharedProfileUrl = ownerPage.url();

    const invitation = ownerPage.getByRole("region", { name: "Пригласить участника" });
    await invitation.getByLabel("Роль приглашения").selectOption("caregiver");
    await invitation.getByRole("button", { name: "Создать код для помощника" }).click();
    const code = await invitation.locator("code").textContent();
    expect(code).toMatch(/^vi_[A-Za-z0-9_-]{43}$/);

    await caregiverPage.goto("/");
    await caregiverPage.getByRole("button", { name: "У меня есть код приглашения" }).click();
    await caregiverPage.getByLabel("Одноразовый код").fill(code ?? "");
    await caregiverPage.getByLabel("Ваше имя").fill(`Помощник ${crypto.randomUUID().slice(0, 8)}`);
    await caregiverPage.getByRole("button", { name: "Присоединиться к семье" }).click();
    await expect(
      caregiverPage.getByRole("heading", { level: 1, name: "Пока нет доступных профилей" }),
    ).toBeVisible();
    await expect(caregiverPage.getByText(names.dependent, { exact: true })).toHaveCount(0);

    await ownerPage.reload();
    const consent = ownerPage.getByRole("region", { name: "Доступ к этому профилю" });
    await expect(consent.getByText("Помощник по уходу", { exact: true })).toBeVisible();
    await consent.getByRole("button", { name: "Разрешить чтение" }).click();
    await expect(consent.getByText("Только чтение", { exact: true })).toBeVisible();

    await caregiverPage.reload();
    await expect(caregiverPage).toHaveURL(/\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}$/);
    await expect(
      caregiverPage.getByRole("heading", { level: 1, name: names.dependent }),
    ).toBeVisible();
    await expect(caregiverPage.getByText("Доступ по согласию: только чтение")).toBeVisible();
    await expect(caregiverPage.getByLabel("Синтетический документ", { exact: true })).toHaveCount(
      0,
    );

    await ownerPage.goto(sharedProfileUrl);
    const refreshedConsent = ownerPage.getByRole("region", { name: "Доступ к этому профилю" });
    await refreshedConsent.getByRole("button", { name: "Отозвать доступ" }).click();
    await caregiverPage.reload();
    await expect(
      caregiverPage.getByRole("heading", { level: 1, name: "Пока нет доступных профилей" }),
    ).toBeVisible();
  } finally {
    await ownerContext.close();
    await caregiverContext.close();
  }
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
