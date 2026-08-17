import { VeyltaApp } from "../../../../../../components/veylta-app";

interface AssistantPageProps {
  params: Promise<{ familyId: string; profileId: string; assistantId: string }>;
  searchParams: Promise<{ conversationId?: string | string[] }>;
}

export default async function AssistantPage({ params, searchParams }: AssistantPageProps) {
  const { familyId, profileId, assistantId } = await params;
  const { conversationId } = await searchParams;
  return (
    <VeyltaApp
      requestedFamilyId={familyId}
      requestedProfileId={profileId}
      requestedAssistantId={assistantId}
      requestedConversationId={Array.isArray(conversationId) ? conversationId[0] : conversationId}
    />
  );
}
