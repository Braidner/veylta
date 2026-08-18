import { canonicalUuidSchema } from "../http/route-helpers.js";

export interface ProfileParams {
  familyId: string;
  profileId: string;
}

export interface ItemParams extends ProfileParams {
  itemId: string;
}

export interface CheckinParams extends ItemParams {
  date: string;
}

export const profileParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["familyId", "profileId"],
  properties: { familyId: canonicalUuidSchema, profileId: canonicalUuidSchema },
} as const;

export const itemParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["familyId", "profileId", "itemId"],
  properties: {
    familyId: canonicalUuidSchema,
    profileId: canonicalUuidSchema,
    itemId: canonicalUuidSchema,
  },
} as const;

export const localDateSchema = {
  anyOf: [{ type: "null" }, { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }],
} as const;

export const checkinParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["familyId", "profileId", "itemId", "date"],
  properties: {
    ...itemParamsSchema.properties,
    date: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
  },
} as const;
