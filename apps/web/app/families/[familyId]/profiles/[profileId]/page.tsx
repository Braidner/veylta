import { LegacyRedirect } from "../../../../components/legacy-redirect";
import { definedOnly } from "../../../../legacy-destination";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The old id-based profile link; the same person and surface now live at `/<handle>`. */
export default async function LegacyProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string; profileId: string }>;
  searchParams: Promise<{ tab?: string | string[]; canonicalCode?: string | string[] }>;
}) {
  const { familyId, profileId } = await params;
  const { tab, canonicalCode } = await searchParams;
  return (
    <LegacyRedirect
      target={definedOnly({
        familyId,
        profileId,
        tab: first(tab),
        canonicalCode: first(canonicalCode),
      })}
    />
  );
}
