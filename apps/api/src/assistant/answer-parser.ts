import {
  ASSISTANT_CLINICIAN_CHECK_CLAIMS,
  ASSISTANT_CONFIDENCE_LEVELS,
  ASSISTANT_CONTRAINDICATION_STATES,
  ASSISTANT_MISSING_CONTEXTS,
  ASSISTANT_SPECIALTIES,
  ASSISTANT_TREATMENT_KINDS,
  ASSISTANT_URGENCY_TIERS,
  type AssistantAnswer,
  type AssistantBlock,
  type AssistantEvidenceRef,
  type AssistantRejectionReason,
  type AssistantUrgency,
  MAX_ASSISTANT_BLOCKS,
} from "@veylta/contracts";
import {
  AssistantAnswerError,
  boundedList,
  boundedText,
  exactKeys,
  keepEach,
  member,
  object,
  refuse,
  russianText,
} from "./answer-fields.js";

export { AssistantAnswerError };

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
/** A dose spelled out — the tool quotes a clinician's prescription, it never writes one. */
const dosePattern =
  /\d+(?:[.,]\d+)?\s?(?:мг|мкг|мл|г\b|ме\b|мме|ед\b|таблет|капсул|ампул|капл|раз(?:а)? в (?:день|сутки|неделю)|р\/д|р\/сут)/iu;
const interpretiveKinds = new Set([
  "interpretation",
  "hypothesis",
  "treatment_option",
  "clinician_check",
]);

function refs(value: unknown, context: AnswerContext): AssistantEvidenceRef[] {
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
function boundRefs(value: unknown, context: AnswerContext): AssistantEvidenceRef[] {
  const kept = refs(value, context);
  if (kept.length === 0) refuse("unbound_reference");
  return kept;
}

function urgency(value: unknown, context: AnswerContext): AssistantUrgency {
  if (value === undefined) refuse("missing_urgency");
  const proposed = object(value);
  exactKeys(proposed, ["tier", "reasons"]);
  return {
    tier: member(proposed.tier, ASSISTANT_URGENCY_TIERS),
    reasons: refs(proposed.reasons, context),
  };
}

function quotesProfileValue(text: string, context: AnswerContext): boolean {
  const numbers = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return numbers.some(
    (number) =>
      context.profileValues.has(number) || context.profileValues.has(number.replace(",", ".")),
  );
}

function block(value: unknown, context: AnswerContext): AssistantBlock {
  const proposed = object(value);
  const kind = typeof proposed.kind === "string" ? proposed.kind : refuse("schema_shape");
  if (!context.interpretationReady && interpretiveKinds.has(kind)) refuse("profile_not_ready");
  switch (kind) {
    case "interpretation":
      exactKeys(proposed, ["kind", "text", "refs"]);
      return {
        kind,
        text: russianText(proposed.text, 800),
        refs: boundRefs(proposed.refs, context),
      };
    case "hypothesis":
      exactKeys(proposed, [
        "kind",
        "name",
        "confidence",
        "rationale",
        "refs",
        "confirmWith",
        "workup",
      ]);
      return {
        kind,
        name: russianText(proposed.name, 200),
        confidence: member(proposed.confidence, ASSISTANT_CONFIDENCE_LEVELS),
        rationale: russianText(proposed.rationale, 800),
        refs: boundRefs(proposed.refs, context),
        confirmWith: member(proposed.confirmWith, ASSISTANT_SPECIALTIES),
        workup: boundedList(proposed.workup, 10).map((item) => boundedText(item, 200)),
      };
    case "treatment_option": {
      exactKeys(proposed, [
        "kind",
        "name",
        "treatmentKind",
        "rationale",
        "refs",
        "contraindications",
        "conflictNotes",
        "confirmWith",
      ]);
      const name = russianText(proposed.name, 200);
      const rationale = russianText(proposed.rationale, 800);
      const treatmentKind = member(proposed.treatmentKind, ASSISTANT_TREATMENT_KINDS);
      if (
        treatmentKind === "medication" &&
        (dosePattern.test(name) || dosePattern.test(rationale))
      ) {
        refuse("prescriptive_dose");
      }
      return {
        kind,
        name,
        treatmentKind,
        rationale,
        refs: boundRefs(proposed.refs, context),
        contraindications: member(proposed.contraindications, ASSISTANT_CONTRAINDICATION_STATES),
        conflictNotes:
          proposed.conflictNotes === null ? null : russianText(proposed.conflictNotes, 500),
        confirmWith: member(proposed.confirmWith, ASSISTANT_SPECIALTIES),
      };
    }
    case "clinician_check": {
      exactKeys(proposed, ["kind", "claim", "theirs", "ours", "why", "refs", "confirmWith"]);
      const theirs = object(proposed.theirs);
      exactKeys(theirs, ["recordId"]);
      if (typeof theirs.recordId !== "string") refuse("schema_shape");
      const recordId = theirs.recordId.toLowerCase();
      if (!context.knownRecordIds.has(recordId)) refuse("unbound_reference");
      const claim = member(proposed.claim, ASSISTANT_CLINICIAN_CHECK_CLAIMS);
      // A view for or against the clinician rests on the person's values; «cannot assess» may not.
      const bound =
        claim === "cannot_assess"
          ? refs(proposed.refs, context)
          : boundRefs(proposed.refs, context);
      return {
        kind,
        claim,
        theirs: { recordId },
        ours: russianText(proposed.ours, 500),
        why: russianText(proposed.why, 800),
        refs: bound,
        confirmWith: member(proposed.confirmWith, ASSISTANT_SPECIALTIES),
      };
    }
    case "question":
      exactKeys(proposed, ["kind", "text", "refs"]);
      return { kind, text: russianText(proposed.text, 500), refs: refs(proposed.refs, context) };
    case "general": {
      exactKeys(proposed, ["kind", "text"]);
      const text = russianText(proposed.text, 800);
      if (quotesProfileValue(text, context)) refuse("general_names_values");
      return { kind, text };
    }
    case "missing":
      exactKeys(proposed, ["kind", "context"]);
      return { kind, context: member(proposed.context, ASSISTANT_MISSING_CONTEXTS) };
    default:
      return refuse("schema_shape");
  }
}

/**
 * Turns the model's raw answer into the typed blocks the UI renders. Verification is per block:
 * a block that cannot be bound, names a dose, or quotes the profile in a "general" statement is
 * dropped; an answer whose every block fails is refused with the last rule broken. Urgency is
 * read first and never lowered because a reference did not resolve.
 */
export function parseAssistantAnswer(text: string, context: AnswerContext): AssistantAnswer {
  return answerFromRoot(parseAnswerJson(text), context, ["urgency", "blocks"]);
}

export function parseAnswerJson(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    refuse("schema_shape");
  }
  return object(parsed);
}

/** The urgency-and-blocks core shared by the physician answer and the консилиум synthesis. */
export function answerFromRoot(
  root: Record<string, unknown>,
  context: AnswerContext,
  keys: readonly string[],
): AssistantAnswer {
  if (!("urgency" in root)) refuse("missing_urgency");
  exactKeys(root, keys);
  const tier = urgency(root.urgency, context);
  const proposals = boundedList(root.blocks, MAX_ASSISTANT_BLOCKS);
  const blocks = keepEach(proposals, (proposal) => block(proposal, context));
  return { urgency: tier, blocks };
}

export type { AssistantRejectionReason };
