import type { ObservationHistoryItem } from "@veylta/contracts";

/** One synthetic confirmed observation for the dossier tests; every field has a plain default. */
export function observation(
  overrides: Partial<{
    id: string;
    code: string | null;
    name: string;
    value: string;
    unit: string;
    at: string;
    low: string | null;
    high: string | null;
    flag: boolean | null;
    text: string | null;
  }>,
): ObservationHistoryItem {
  const at = overrides.at ?? "2026-08-10T08:00:00.000Z";
  return {
    id: overrides.id ?? `o-${at}`,
    canonicalCode: overrides.code === undefined ? "tsh" : overrides.code,
    source: {
      name: overrides.name ?? "ТТГ",
      value: overrides.value ?? "6,8",
      unit: overrides.unit ?? "мМЕ/л",
    },
    normalized: { value: null, unit: null, conversionVersion: null },
    referenceRange:
      overrides.low === null && overrides.high === null && overrides.text === null
        ? null
        : {
            sourceText: overrides.text ?? "0,4 - 4,0",
            sourceLow: overrides.low === undefined ? "0,4" : overrides.low,
            sourceHigh: overrides.high === undefined ? "4,0" : overrides.high,
            sourceUnit: overrides.unit ?? "мМЕ/л",
            laboratoryOutOfRange: overrides.flag ?? null,
            normalizedLow: null,
            normalizedHigh: null,
            normalizedUnit: null,
            conversionVersion: null,
          },
    dates: { sampledAt: at, resultedAt: null, uploadedAt: at },
    timelineAt: at,
    specimenType: null,
    laboratory: "Синтетическая лаборатория",
    extractionConfidence: 0.9,
    confirmed: { at, by: { id: "u", displayName: "Владелец" } },
    sourceDocument: {
      id: "d",
      versionId: "v",
      pageNumber: 1,
      fragment: "ТТГ 6,8 мМЕ/л 0,4 - 4,0",
      contentPath: "/v1/x",
    },
  };
}
