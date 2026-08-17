import type { AssistantEvidenceItem, AssistantInvitation } from "@veylta/contracts";

/** The printed names of the observations that put a specialist on the panel, each once. */
export function invitationNames(
  invitation: AssistantInvitation,
  evidence: ReadonlyMap<string, AssistantEvidenceItem>,
): string[] {
  return [
    ...new Set(
      invitation.observationIds
        .map((observationId) => evidence.get(observationId)?.name)
        .filter((name): name is string => name !== undefined),
    ),
  ];
}

/** Why a specialist is on the panel: every name — for the opinion's own heading. */
export function invitationCopy(
  invitation: AssistantInvitation,
  evidence: ReadonlyMap<string, AssistantEvidenceItem>,
): string {
  const names = invitationNames(invitation, evidence);
  return names.length === 0 ? "по вашему запросу" : `в данных: ${names.join(", ")}`;
}

/** The same reason in one line: three names and a count, so a specialist with forty stays a chip. */
export function invitationSummary(
  invitation: AssistantInvitation,
  evidence: ReadonlyMap<string, AssistantEvidenceItem>,
  shown = 3,
): string {
  const names = invitationNames(invitation, evidence);
  if (names.length === 0) return "по вашему запросу";
  const rest = names.length - shown;
  return `в данных: ${names.slice(0, shown).join(", ")}${rest > 0 ? ` и ещё ${rest}` : ""}`;
}
