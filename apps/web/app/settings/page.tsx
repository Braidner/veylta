import { LegacyRedirect } from "../components/legacy-redirect";
import { definedOnly } from "../legacy-destination";

/** The old settings link; settings is a page of a person now — `/<handle>/settings`. */
export default async function LegacySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string | string[] }>;
}) {
  const { profile } = await searchParams;
  const profileId = Array.isArray(profile) ? profile[0] : profile;
  return <LegacyRedirect target={definedOnly({ profileId, settings: "user" as const })} />;
}
