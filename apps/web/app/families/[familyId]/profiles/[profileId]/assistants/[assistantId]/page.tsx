import { LegacyRedirect } from "../../../../../../components/legacy-redirect";
import { definedOnly } from "../../../../../../legacy-destination";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The old id-based assistant link; the room now lives at `/<handle>/assistants/<assistantId>`. */
export default async function LegacyAssistantPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string; profileId: string; assistantId: string }>;
  searchParams: Promise<{ conversationId?: string | string[]; ask?: string | string[] }>;
}) {
  const { familyId, profileId, assistantId } = await params;
  const { conversationId, ask } = await searchParams;
  return (
    <LegacyRedirect
      target={definedOnly({
        familyId,
        profileId,
        assistantId,
        conversationId: first(conversationId),
        ask: first(ask),
      })}
    />
  );
}
