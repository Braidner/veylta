import type { DatabaseClient } from "../database/pool.js";
import { resolveAnalyteMapping } from "../processing/analyte-mapping.js";
import { CODEX_DOCUMENT_INTELLIGENCE_VERSION } from "../processing/codex-intelligence/constants.js";
import { ObjectStorageIntegrityError } from "../storage/object-storage.js";

interface StoredFactAnalyte {
  readonly proposed_laboratory: string | null;
  readonly proposed_canonical_code: string | null;
  readonly proposed_normalized_value: string | null;
  readonly proposed_normalized_unit: string | null;
}

export interface ReviewedAnalyte {
  readonly canonicalCode: string | null;
  readonly normalizedValue: string | null;
  readonly normalizedUnit: string | null;
  readonly conversionVersion: string | null;
}

function bounded(value: unknown, maximum: number, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new ObjectStorageIntegrityError(`Stored ${label} is invalid`);
  }
  return value;
}

/**
 * The analyte an observation is filed under follows what the person confirmed. A correction
 * may rename the value, so the catalog is asked about the corrected name and unit first; only
 * when the catalog does not know that spelling does the model's proposal stand, so a renamed
 * result keeps its series while a result renamed to another catalog analyte moves. A
 * correction never carries a normalization: Veylta performs no conversions and takes none on
 * trust.
 */
export async function reviewedAnalyte(
  client: DatabaseClient,
  fact: StoredFactAnalyte,
  decision: "confirm" | "correct",
  confirmed: { sourceName: string; sourceValue: string; sourceUnit: string },
): Promise<ReviewedAnalyte> {
  const mapped = await resolveAnalyteMapping(client, {
    sourceName: confirmed.sourceName,
    sourceUnit: confirmed.sourceUnit,
    sourceValue: confirmed.sourceValue,
    proposedLaboratory: fact.proposed_laboratory,
  });
  const canonicalCode = bounded(
    mapped?.canonicalCode ?? fact.proposed_canonical_code,
    100,
    "fact canonical code",
  );
  const normalizedValue =
    decision === "correct"
      ? null
      : bounded(
          mapped?.normalizedValue ?? fact.proposed_normalized_value,
          100,
          "fact normalized value",
        );
  const normalizedUnit =
    decision === "correct"
      ? null
      : bounded(
          mapped?.normalizedUnit ?? fact.proposed_normalized_unit,
          100,
          "fact normalized unit",
        );
  if ((normalizedValue === null) !== (normalizedUnit === null)) {
    throw new ObjectStorageIntegrityError("Stored fact normalization is invalid");
  }
  return {
    canonicalCode,
    normalizedValue,
    normalizedUnit,
    conversionVersion:
      normalizedValue === null
        ? null
        : mapped === null
          ? CODEX_DOCUMENT_INTELLIGENCE_VERSION
          : "analyte-alias/v1",
  };
}
