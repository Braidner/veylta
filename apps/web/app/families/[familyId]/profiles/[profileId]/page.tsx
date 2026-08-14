import { VeyltaApp } from "../../../../components/veylta-app";

interface ProfilePageProps {
  params: Promise<{ familyId: string; profileId: string }>;
  searchParams: Promise<{
    tab?: string | string[];
    canonicalCode?: string | string[];
  }>;
}

export default async function ProfilePage({ params, searchParams }: ProfilePageProps) {
  const { familyId, profileId } = await params;
  const { tab, canonicalCode } = await searchParams;
  return (
    <VeyltaApp
      requestedFamilyId={familyId}
      requestedProfileId={profileId}
      requestedTab={Array.isArray(tab) ? tab[0] : tab}
      requestedCanonicalCode={Array.isArray(canonicalCode) ? canonicalCode[0] : canonicalCode}
    />
  );
}
