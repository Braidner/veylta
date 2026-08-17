import {
  ASSISTANT_SPECIALTIES,
  type AssistantInvitation,
  type AssistantSpecialty,
  analyteSpecialty,
  MAX_CONSILIUM_SPECIALISTS,
} from "@veylta/contracts";
import type { AssistantEvidence } from "./evidence.js";

/**
 * Who joins the консилиум is decided from the evidence, not by the model: the household's own
 * analyte table (`ANALYTE_READINGS` in contracts) says which specialty reads each code. The
 * therapist owns everything unassigned — inflammation markers, proteins, vitamins — and the
 * synthesis.
 */
function recordedSex(evidence: AssistantEvidence): "female" | "male" | null {
  const sex = evidence.medicalProfile.entries.find((entry) => entry.kind === "sex")?.value;
  return sex === "female" || sex === "male" ? sex : null;
}

/**
 * The specialists the evidence calls for, largest field first (ties in the specialties'
 * catalogue order, so the panel reads the same whatever order the values were confirmed in),
 * capped; each with the observations that invited them.
 */
export function consiliumPanel(evidence: AssistantEvidence): AssistantInvitation[] {
  const byId = new Map<AssistantSpecialty, string[]>();
  const sex = recordedSex(evidence);
  for (const observation of evidence.observations) {
    const specialty = analyteSpecialty(observation.code, sex);
    if (specialty === null) continue;
    const ids = byId.get(specialty) ?? [];
    ids.push(observation.observationId);
    byId.set(specialty, ids);
  }
  return [...byId.entries()]
    .map(([specialty, observationIds]) => ({ specialty, observationIds }))
    .sort(
      (a, b) =>
        b.observationIds.length - a.observationIds.length ||
        ASSISTANT_SPECIALTIES.indexOf(a.specialty) - ASSISTANT_SPECIALTIES.indexOf(b.specialty),
    )
    .slice(0, MAX_CONSILIUM_SPECIALISTS);
}
