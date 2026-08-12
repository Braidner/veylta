import { VeyltaApp } from "../../../../components/veylta-app";

interface ProfilePageProps {
  params: Promise<{ familyId: string; profileId: string }>;
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { familyId, profileId } = await params;
  return <VeyltaApp requestedFamilyId={familyId} requestedProfileId={profileId} />;
}
