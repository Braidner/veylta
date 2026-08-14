import { expect, type Page } from "@playwright/test";

const webOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_WEB_PORT ?? "4400"}`;

interface SyntheticFamilyNames {
  owner: string;
  family: string;
  profile: string;
}

interface DemoRegistrationResponse {
  family: { id: string };
  profile: { id: string };
}

interface DemoInvitationAcceptResponse {
  family: { id: string };
  profile: { id: string } | null;
}

export async function createSyntheticFamily(
  page: Page,
  names: SyntheticFamilyNames,
): Promise<string> {
  const response = await page.request.post("/health-api/v1/demo/registrations", {
    headers: { origin: webOrigin },
    data: {
      displayName: names.owner,
      familyName: names.family,
      profileName: names.profile,
    },
  });
  expect(response.status()).toBe(201);
  const registration = (await response.json()) as DemoRegistrationResponse;
  const path = `/families/${registration.family.id}/profiles/${registration.profile.id}`;
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  return page.url();
}

export async function acceptSyntheticInvitation(
  page: Page,
  input: { code: string; displayName: string; profileName?: string },
): Promise<DemoInvitationAcceptResponse> {
  const response = await page.request.post("/health-api/v1/demo/invitations/accept", {
    headers: { origin: webOrigin },
    data: input,
  });
  expect(response.status()).toBe(201);
  const accepted = (await response.json()) as DemoInvitationAcceptResponse;
  await page.goto(
    accepted.profile === null
      ? "/"
      : `/families/${accepted.family.id}/profiles/${accepted.profile.id}`,
  );
  return accepted;
}
