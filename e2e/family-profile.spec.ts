import { type Browser, expect, type Page, test } from "@playwright/test";
import { acceptSyntheticInvitation, createSyntheticFamily } from "./support/synthetic-family";

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

  await createSyntheticFamily(page, names);
  await expect(page.getByRole("heading", { level: 1, name: names.profile })).toBeVisible();
  await expect(page).toHaveTitle(`${names.profile} — Veylta`);
  const overview = page.getByRole("region", { name: "Обзор профиля" });
  await expect(overview).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Основные разделы профиля" })).toBeVisible();
  await expect(overview.getByRole("heading", { name: "Помощники" })).toBeVisible();
  await expect(overview.getByText("Не заменяют специалиста", { exact: true })).toBeVisible();
  const signals = overview.getByRole("region", { name: "Сигналы здоровья" });
  await expect(signals).toBeVisible();
  await expect(signals.getByText("Без общего балла", { exact: true })).toBeVisible();
  await expect(signals.getByText("Ждёт проверки", { exact: true })).toBeVisible();
  await expect(signals.getByText("Отмечено источником", { exact: true })).toBeVisible();
  await expect(signals.getByText("Подтверждено", { exact: true })).toBeVisible();
  await openDocumentsTab(page);
  const archive = page.getByRole("region", { name: "Архив документов" });
  await expect(archive.getByText("Исходников пока нет.")).toBeVisible();
  await expect(archive.getByText("Экспорт источников", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Обзор", exact: true }).click();
  await expect(page).toHaveURL(/\/profiles\/[0-9a-f-]{36}$/);

  return names;
}

/** Family profiles and access are administration, so they live under «Настройки». */
async function openProfileManagement(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Настройки" }).click();
  await expect(page.getByRole("tabpanel", { name: "Настройки" })).toBeVisible();
  await expect(page.getByTestId("profile-settings")).toBeVisible();
}

async function openDocumentsTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Документы", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "Документы" })).toBeVisible();
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

  await openProfileManagement(page);
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
  await expect(
    page.getByRole("heading", { level: 1, name: /Настройте домашнюю Veylta|Войдите в Veylta/ }),
  ).toBeVisible();
});

test("an owner can inspect the payload-free family activity log", async ({ page }) => {
  await registerDemoFamily(page);
  await openProfileManagement(page);

  const auditLog = page.getByRole("region", { name: "Журнал действий семьи" });
  await expect(auditLog).toBeVisible();
  await expect(auditLog.getByRole("heading", { name: "Журнал действий семьи" })).toBeVisible();
  await expect(auditLog.getByText("Создана семья")).toBeVisible();
  await expect(auditLog.getByText("Создан профиль")).toBeVisible();
  await expect(auditLog).not.toContainText("metadata");
  await expect(auditLog).not.toContainText("correlation");
});

test("an owner archives and restores a profile without deleting it", async ({ page }) => {
  const names = await registerDemoFamily(page);
  const ownerProfileUrl = page.url();

  await openProfileManagement(page);
  await page.getByRole("button", { name: "Добавить профиль" }).click();
  await page.getByLabel("Имя нового профиля").fill(names.dependent);
  await page.getByRole("button", { name: "Создать профиль" }).click();
  await expect(page.getByRole("heading", { level: 1, name: names.dependent })).toBeVisible();

  await page.getByLabel("Активный профиль").selectOption({ label: names.profile });
  await expect(page).toHaveURL(ownerProfileUrl);
  await openProfileManagement(page);
  const archive = page.getByRole("region", { name: "Архив профиля" });
  await expect(archive).toBeVisible();
  await archive.getByRole("button", { name: "Архивировать профиль" }).click();
  await expect(archive.getByText("Подтвердите архивирование", { exact: true })).toBeVisible();
  await archive.getByRole("button", { name: "Подтвердить архивирование" }).click();

  await expect(page.getByRole("heading", { level: 1, name: names.dependent })).toBeVisible();
  await expect(page.getByLabel("Активный профиль")).not.toContainText(names.profile);

  await openProfileManagement(page);
  const restoredArchive = page.getByRole("region", { name: "Архив профиля" });
  await restoredArchive.getByRole("button", { name: "Показать архивные профили" }).click();
  await expect(restoredArchive.getByText(names.profile, { exact: true })).toBeVisible();
  await restoredArchive.getByRole("button", { name: `Восстановить ${names.profile}` }).click();
  await expect(restoredArchive.getByText("Архивных профилей пока нет.")).toBeVisible();

  // Restore stays in settings; the active-profile switcher lives on the profile pages.
  await page.getByRole("tab", { name: "Обзор", exact: true }).click();
  await page.getByLabel("Активный профиль").selectOption({ label: names.profile });
  await expect(page).toHaveURL(ownerProfileUrl);
  await expect(page.getByRole("heading", { level: 1, name: names.profile })).toBeVisible();
});

test("an owner can issue a one-time local adult invitation with no access to another profile", async ({
  page,
}) => {
  const names = await registerDemoFamily(page);
  const ownerProfile = page.url();

  await openProfileManagement(page);
  const invitation = page.getByRole("region", { name: "Пригласить участника" });
  await expect(invitation).toBeVisible();
  await invitation.getByRole("button", { name: "Создать код для взрослого" }).click();
  const code = await invitation.locator("code").textContent();
  expect(code).toMatch(/^vi_[A-Za-z0-9_-]{43}$/);

  await page.getByRole("button", { name: "Выйти" }).click();
  const adultProfile = `Личный профиль ${crypto.randomUUID().slice(0, 8)}`;
  await acceptSyntheticInvitation(page, {
    code: code ?? "",
    displayName: `Участник ${crypto.randomUUID().slice(0, 8)}`,
    profileName: adultProfile,
  });

  await expect(page).toHaveURL(/\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: adultProfile })).toBeVisible();
  await expect(page.getByText("Участник пространства", { exact: true })).toBeVisible();
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
    await openProfileManagement(ownerPage);
    const invitation = ownerPage.getByRole("region", { name: "Пригласить участника" });
    await invitation.getByRole("button", { name: "Создать код для взрослого" }).click();
    const code = await invitation.locator("code").textContent();
    expect(code).toMatch(/^vi_[A-Za-z0-9_-]{43}$/);

    const adultProfile = `Личный профиль ${crypto.randomUUID().slice(0, 8)}`;
    await acceptSyntheticInvitation(adultPage, {
      code: code ?? "",
      displayName: `Читатель ${crypto.randomUUID().slice(0, 8)}`,
      profileName: adultProfile,
    });
    await expect(adultPage.getByRole("heading", { level: 1, name: adultProfile })).toBeVisible();

    await ownerPage.reload();
    await openProfileManagement(ownerPage);
    const consent = ownerPage.getByRole("region", { name: "Доступ к этому профилю" });
    await expect(consent).toBeVisible();
    await consent.getByRole("button", { name: "Разрешить чтение" }).click();
    await expect(consent.getByText("Только чтение", { exact: true })).toBeVisible();
    await expect(consent.getByRole("button", { name: "Отозвать доступ" })).toBeVisible();

    await adultPage.goto(ownerProfileUrl);
    await expect(adultPage.getByRole("heading", { level: 1, name: names.profile })).toBeVisible();
    await expect(
      adultPage.locator(".profile-heading__access").getByText("Только чтение", { exact: true }),
    ).toBeVisible();
    await openDocumentsTab(adultPage);
    await expect(
      adultPage.getByRole("heading", { level: 2, name: "Доступ выдан владельцем профиля" }),
    ).toBeVisible();
    await expect(adultPage.getByRole("button", { name: "Загрузить документ" })).toHaveCount(0);

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
    await openProfileManagement(ownerPage);
    await ownerPage.getByRole("button", { name: "Добавить профиль" }).click();
    await ownerPage.getByLabel("Имя нового профиля").fill(names.dependent);
    await ownerPage.getByRole("button", { name: "Создать профиль" }).click();
    await expect(ownerPage).toHaveURL(/\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}$/);
    await expect(ownerPage.getByRole("heading", { level: 1, name: names.dependent })).toBeVisible();
    const sharedProfileUrl = ownerPage.url();

    await openProfileManagement(ownerPage);
    const invitation = ownerPage.getByRole("region", { name: "Пригласить участника" });
    await invitation.getByLabel("Роль приглашения").selectOption("caregiver");
    await invitation.getByRole("button", { name: "Создать код для помощника" }).click();
    const code = await invitation.locator("code").textContent();
    expect(code).toMatch(/^vi_[A-Za-z0-9_-]{43}$/);

    await acceptSyntheticInvitation(caregiverPage, {
      code: code ?? "",
      displayName: `Помощник ${crypto.randomUUID().slice(0, 8)}`,
    });
    await expect(
      caregiverPage.getByRole("heading", { level: 1, name: "Пока нет доступных профилей" }),
    ).toBeVisible();
    await expect(caregiverPage.getByText(names.dependent, { exact: true })).toHaveCount(0);

    await ownerPage.reload();
    await openProfileManagement(ownerPage);
    const consent = ownerPage.getByRole("region", { name: "Доступ к этому профилю" });
    await expect(consent.getByText("Помощник по уходу", { exact: true })).toBeVisible();
    await consent.getByRole("button", { name: "Разрешить чтение" }).click();
    await expect(consent.getByText("Только чтение", { exact: true })).toBeVisible();

    await caregiverPage.reload();
    await expect(caregiverPage).toHaveURL(/\/families\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}$/);
    await expect(
      caregiverPage.getByRole("heading", { level: 1, name: names.dependent }),
    ).toBeVisible();
    await expect(
      caregiverPage.locator(".profile-heading__access").getByText("Только чтение", { exact: true }),
    ).toBeVisible();
    await expect(caregiverPage.getByRole("button", { name: "Загрузить документ" })).toHaveCount(0);

    await ownerPage.goto(sharedProfileUrl);
    await openProfileManagement(ownerPage);
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
