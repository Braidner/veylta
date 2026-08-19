import { VeyltaApp } from "../../../components/veylta-app";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** `/<handle>/assistants/<assistantId>` — one assistant's room, optionally on one conversation. */
export default async function AssistantPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; assistantId: string }>;
  searchParams: Promise<{ conversationId?: string | string[]; ask?: string | string[] }>;
}) {
  const { handle, assistantId } = await params;
  const { conversationId, ask } = await searchParams;
  return (
    <VeyltaApp
      requestedHandle={handle}
      requestedAssistantId={assistantId}
      requestedConversationId={first(conversationId)}
      requestedAssistantAsk={first(ask)}
    />
  );
}
