import { FamilyHealthApp } from "../../../../../../components/family-health-app";

interface DocumentPageProps {
  params: Promise<{ familyId: string; profileId: string; documentId: string }>;
}

export default async function DocumentPage({ params }: DocumentPageProps) {
  const { familyId, profileId, documentId } = await params;
  return (
    <FamilyHealthApp
      requestedFamilyId={familyId}
      requestedProfileId={profileId}
      requestedDocumentId={documentId}
    />
  );
}
