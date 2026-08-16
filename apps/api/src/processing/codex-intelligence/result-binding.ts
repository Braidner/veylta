import type { DocumentIntelligenceStructuredResult } from "@veylta/contracts";
import { normalizeAnalyteUnit } from "../analyte-mapping.js";
import type { StrictLabExtractionFact } from "../synthetic-lab-parser.js";
import { KeyRegistry } from "./answer-items.js";
import { invalidOutput } from "./errors.js";
import { computedAboveRange, numericSourceValue, sameReading } from "./readings.js";

type Result = DocumentIntelligenceStructuredResult;

function sameLine(left: { pageNumber: number; fragment: string }, right: typeof left): boolean {
  return (
    left.pageNumber === right.pageNumber &&
    (left.fragment.includes(right.fragment) || right.fragment.includes(left.fragment))
  );
}

/** A result and a fact read the same line the same way: same number, same unit, same page. */
function sameMeasurement(result: Result, fact: StrictLabExtractionFact): boolean {
  return (
    result.type === "measurement" &&
    result.value !== null &&
    sameReading(result.value, fact.sourceValue) &&
    (result.unit === null ||
      normalizeAnalyteUnit(result.unit) === normalizeAnalyteUnit(fact.sourceUnit)) &&
    sameLine(result.source, fact.source)
  );
}

/** The model's status is settled against the fact: an above_range it cannot prove is dropped. */
function settledStatus(result: Result, fact: StrictLabExtractionFact | undefined): Result {
  const aboveRange = computedAboveRange(fact);
  if (aboveRange === true) return { ...result, status: "above_range" };
  return result.status === "above_range" ? { ...result, status: "unknown" } : result;
}

/**
 * Binds every summary result to the fact it reads, by content: same number, unit and line.
 * The model's key only matters when nothing matches — a key naming a fact that reads the same
 * line with another value is a contradiction and refuses the run; one naming a fact on a
 * different line is misaligned numbering, and the result stays unbound under a key of its own.
 * A bound result takes its fact's key, so the two can be joined downstream.
 */
export function bindResultsToFacts(
  results: readonly Result[],
  facts: readonly StrictLabExtractionFact[],
): Result[] {
  const keys = new KeyRegistry(facts.map((fact) => fact.factKey));
  const linked = new Set<string>();
  return results.map((result) => {
    const matching = facts.filter((fact) => sameMeasurement(result, fact));
    if (matching.length > 1) invalidOutput("duplicate_binding");
    const boundFact = matching[0];
    const sameKeyFact = facts.find((fact) => fact.factKey === result.resultKey);
    if (
      boundFact === undefined &&
      sameKeyFact !== undefined &&
      sameLine(sameKeyFact.source, result.source)
    ) {
      invalidOutput("duplicate_binding");
    }
    const resultKey = boundFact?.factKey ?? keys.claim(result.resultKey);
    if (linked.has(resultKey)) invalidOutput("duplicate_binding");
    linked.add(resultKey);
    const settled = settledStatus(result, boundFact);
    return resultKey === settled.resultKey ? settled : { ...settled, resultKey };
  });
}

/**
 * In a laboratory report the summary's numeric measurements are the facts. A summary that
 * mostly outruns the facts is an incomplete extraction; refusing it lets the retry ask again
 * instead of presenting a fraction of the document as the whole.
 */
export function requireCompleteFacts(
  category: string,
  results: readonly Result[],
  facts: readonly StrictLabExtractionFact[],
): void {
  if (category !== "laboratory") return;
  const factKeys = new Set(facts.map((fact) => fact.factKey));
  const unboundMeasurements = results.filter(
    (result) =>
      result.type === "measurement" &&
      numericSourceValue(result.value) !== null &&
      !factKeys.has(result.resultKey),
  ).length;
  if (unboundMeasurements > facts.length) invalidOutput("incomplete_facts");
}
