import { FamilyHealthApp } from "../../../../components/family-health-app";

interface ProfilePageProps {
  params: Promise<{ familyId: string; profileId: string }>;
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { familyId, profileId } = await params;
  return <FamilyHealthApp requestedFamilyId={familyId} requestedProfileId={profileId} />;
}
