import {
  ASSISTANT_CLINICIAN_CHECK_CLAIMS,
  ASSISTANT_CONFIDENCE_LEVELS,
  ASSISTANT_CONTRAINDICATION_STATES,
  ASSISTANT_DIET_CATEGORIES,
  ASSISTANT_MISSING_CONTEXTS,
  ASSISTANT_SPECIALTIES,
  ASSISTANT_TREATMENT_KINDS,
  type AssistantBlock,
} from "@veylta/contracts";
import {
  boundedList,
  boundedText,
  exactKeys,
  member,
  object,
  refuse,
  russianText,
} from "./answer-fields.js";
import { type AnswerContext, boundRefs, refs } from "./answer-refs.js";

/**
 * A dose spelled out — the tool quotes a clinician's prescription, it never writes one. `\b` knows
 * only ASCII letters, so a Cyrillic unit ends on a lookahead instead («2000 МЕ», «500 г в день»).
 */
const dosePattern =
  /\d+(?:[.,]\d+)?\s?(?:мг|мкг|мл|г(?![\p{L}\p{N}])|ме(?![\p{L}\p{N}])|мме|ед(?![\p{L}\p{N}])|таблет|капсул|ампул|капл|раз(?:а)? в (?:день|сутки|неделю)|р\/д|р\/сут)/iu;
const interpretiveKinds = new Set([
  "interpretation",
  "hypothesis",
  "treatment_option",
  "clinician_check",
  "diet_assessment",
  "diet_recommendation",
  "recheck",
]);

function quotesProfileValue(text: string, context: AnswerContext): boolean {
  const numbers = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return numbers.some(
    (number) =>
      context.profileValues.has(number) || context.profileValues.has(number.replace(",", ".")),
  );
}

/** One proposed block verified against the evidence; a broken rule refuses this block only. */
export function block(value: unknown, context: AnswerContext): AssistantBlock {
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
    case "diet_assessment":
      exactKeys(proposed, ["kind", "text", "refs"]);
      return {
        kind,
        text: russianText(proposed.text, 800),
        refs: boundRefs(proposed.refs, context),
      };
    case "diet_recommendation": {
      exactKeys(proposed, [
        "kind",
        "name",
        "category",
        "rationale",
        "refs",
        "interaction",
        "conflictNotes",
        "confirmWith",
      ]);
      const name = russianText(proposed.name, 200);
      const rationale = russianText(proposed.rationale, 800);
      const category = member(proposed.category, ASSISTANT_DIET_CATEGORIES);
      // A supplement is named or classed, never dosed — the dose is the clinician's to write.
      if (category === "supplement" && (dosePattern.test(name) || dosePattern.test(rationale))) {
        refuse("prescriptive_dose");
      }
      return {
        kind,
        name,
        category,
        rationale,
        refs: refs(proposed.refs, context),
        interaction: member(proposed.interaction, ASSISTANT_CONTRAINDICATION_STATES),
        conflictNotes:
          proposed.conflictNotes === null ? null : russianText(proposed.conflictNotes, 500),
        confirmWith: member(proposed.confirmWith, ASSISTANT_SPECIALTIES),
      };
    }
    case "recheck":
      exactKeys(proposed, ["kind", "text", "when", "refs"]);
      return {
        kind,
        text: russianText(proposed.text, 300),
        when: russianText(proposed.when, 100),
        refs: boundRefs(proposed.refs, context),
      };
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
