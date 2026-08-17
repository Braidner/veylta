// The closed JSON schema the physician answers in, and the checker's. Mirrors answer-parser.ts:
// the schema keeps the model on the shape, the parser verifies every block against the evidence.
import {
  ASSISTANT_CHECKER_VERDICTS,
  ASSISTANT_CONFIDENCE_LEVELS,
  ASSISTANT_CONTRAINDICATION_STATES,
  ASSISTANT_MISSING_CONTEXTS,
  ASSISTANT_SPECIALTIES,
  ASSISTANT_TREATMENT_KINDS,
  ASSISTANT_URGENCY_TIERS,
  MAX_ASSISTANT_BLOCKS,
} from "@veylta/contracts";

const russian = (maximum: number) => ({
  type: "string",
  minLength: 1,
  maxLength: maximum,
  pattern: "^[\\s\\S]*[А-Яа-яЁё][\\s\\S]*$",
});
const uuid = {
  type: "string",
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
};
const refs = {
  type: "array",
  maxItems: 12,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["observationId"],
    properties: { observationId: uuid },
  },
};
const specialty = { type: "string", enum: ASSISTANT_SPECIALTIES };

function blockOf(kind: string, properties: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["kind", ...Object.keys(properties)],
    properties: { kind: { type: "string", enum: [kind] }, ...properties },
  };
}

export const physicianAnswerSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["urgency", "blocks"],
  properties: {
    urgency: {
      type: "object",
      additionalProperties: false,
      required: ["tier", "reasons"],
      properties: {
        tier: {
          type: "string",
          enum: ASSISTANT_URGENCY_TIERS,
          description:
            "emergency: the evidence can mean an immediate danger; urgent: a clinician within days; soon: within weeks; routine: at the next planned visit; none: nothing to act on.",
        },
        reasons: refs,
      },
    },
    blocks: {
      type: "array",
      maxItems: MAX_ASSISTANT_BLOCKS,
      items: {
        anyOf: [
          blockOf("interpretation", { text: russian(800), refs }),
          blockOf("hypothesis", {
            name: russian(200),
            confidence: { type: "string", enum: ASSISTANT_CONFIDENCE_LEVELS },
            rationale: russian(800),
            refs,
            confirmWith: specialty,
            workup: {
              type: "array",
              maxItems: 10,
              items: { type: "string", minLength: 1, maxLength: 200 },
            },
          }),
          blockOf("treatment_option", {
            name: russian(200),
            treatmentKind: { type: "string", enum: ASSISTANT_TREATMENT_KINDS },
            rationale: russian(800),
            refs,
            contraindications: { type: "string", enum: ASSISTANT_CONTRAINDICATION_STATES },
            conflictNotes: { anyOf: [russian(500), { type: "null" }] },
            confirmWith: specialty,
          }),
          blockOf("question", { text: russian(500), refs }),
          blockOf("general", { text: russian(800) }),
          blockOf("missing", { context: { type: "string", enum: ASSISTANT_MISSING_CONTEXTS } }),
        ],
      },
    },
  },
} as const;

export const checkerSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["verdicts", "urgency"],
  properties: {
    verdicts: {
      type: "array",
      maxItems: MAX_ASSISTANT_BLOCKS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["blockIndex", "verdict", "note"],
        properties: {
          blockIndex: { type: "integer", minimum: 0, maximum: MAX_ASSISTANT_BLOCKS - 1 },
          verdict: { type: "string", enum: ASSISTANT_CHECKER_VERDICTS },
          note: { anyOf: [{ type: "string", minLength: 1, maxLength: 300 }, { type: "null" }] },
        },
      },
    },
    urgency: { type: "string", enum: ASSISTANT_URGENCY_TIERS },
  },
} as const;
