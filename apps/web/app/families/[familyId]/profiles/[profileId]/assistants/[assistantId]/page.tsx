import { VeyltaApp } from "../../../../../../components/veylta-app";

interface AssistantPageProps {
  params: Promise<{ familyId: string; profileId: string; assistantId: string }>;
  searchParams: Promise<{ conversationId?: string | string[]; ask?: string | string[] }>;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function AssistantPage({ params, searchParams }: AssistantPageProps) {
  const { familyId, profileId, assistantId } = await params;
  const { conversationId, ask } = await searchParams;
  return (
    <VeyltaApp
      requestedFamilyId={familyId}
      requestedProfileId={profileId}
      requestedAssistantId={assistantId}
      requestedConversationId={first(conversationId)}
      requestedAssistantAsk={first(ask)}
    />
  );
}
