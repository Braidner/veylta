import type { AssistantEvidenceRef } from "@veylta/contracts";
import { boundedList, exactKeys, object, refuse } from "./answer-fields.js";

export interface AnswerContext {
  /** Confirmed observations the assistant was shown; a reference outside them does not resolve. */
  readonly knownObservationIds: ReadonlySet<string>;
  /** Confirmed clinician records it was shown; a сверка of any other record is dropped. */
  readonly knownRecordIds: ReadonlySet<string>;
  /** Printed values of those observations; a "general" block may not quote any of them. */
  readonly profileValues: ReadonlySet<string>;
  /** Sex and birth year recorded: without them the assistant may only ask and explain. */
  readonly interpretationReady: boolean;
}

const maximumRefs = 12;

export function refs(value: unknown, context: AnswerContext): AssistantEvidenceRef[] {
  const items = boundedList(value, maximumRefs);
  const seen = new Set<string>();
  const kept: AssistantEvidenceRef[] = [];
  for (const item of items) {
    const ref = object(item);
    exactKeys(ref, ["observationId"]);
    if (typeof ref.observationId !== "string") refuse("schema_shape");
    const observationId = ref.observationId.toLowerCase();
    if (!context.knownObservationIds.has(observationId) || seen.has(observationId)) continue;
    seen.add(observationId);
    kept.push({ observationId });
  }
  return kept;
}

/** Evidence-bearing blocks must keep at least one resolved reference or they say nothing. */
export function boundRefs(value: unknown, context: AnswerContext): AssistantEvidenceRef[] {
  const kept = refs(value, context);
  if (kept.length === 0) refuse("unbound_reference");
  return kept;
}
