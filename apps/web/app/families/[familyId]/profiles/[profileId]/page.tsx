import { VeyltaApp } from "../../../../components/veylta-app";

interface ProfilePageProps {
  params: Promise<{ familyId: string; profileId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}

export default async function ProfilePage({ params, searchParams }: ProfilePageProps) {
  const { familyId, profileId } = await params;
  const { tab } = await searchParams;
  return (
    <VeyltaApp
      requestedFamilyId={familyId}
      requestedProfileId={profileId}
      requestedTab={Array.isArray(tab) ? tab[0] : tab}
    />
  );
}
