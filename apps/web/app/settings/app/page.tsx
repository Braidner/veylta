import { LegacyRedirect } from "../../components/legacy-redirect";
import { definedOnly } from "../../legacy-destination";

/** The old server-settings link; «Приложение» is a page of a person now — `/<handle>/settings/app`. */
export default async function LegacySettingsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string | string[] }>;
}) {
  const { profile } = await searchParams;
  const profileId = Array.isArray(profile) ? profile[0] : profile;
  return <LegacyRedirect target={definedOnly({ profileId, settings: "app" as const })} />;
}
