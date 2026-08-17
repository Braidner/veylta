import assert from "node:assert/strict";
import test from "node:test";
import { referenceRangeCopy } from "./reference-range-copy";

test("the printed reference is the source text, else the bounds, else «Не указан»", () => {
  const range = { sourceText: null, sourceLow: "3,5", sourceHigh: "5,5", sourceUnit: "ммоль/л" };
  assert.equal(referenceRangeCopy({ ...range, sourceText: "3,5 - 5,5" }), "3,5 - 5,5");
  assert.equal(referenceRangeCopy(range), "3,5–5,5 ммоль/л");
  assert.equal(referenceRangeCopy({ ...range, sourceUnit: null }), "3,5–5,5");
  assert.equal(referenceRangeCopy({ ...range, sourceLow: null }), "…–5,5 ммоль/л");
  assert.equal(
    referenceRangeCopy({ sourceText: null, sourceLow: null, sourceHigh: null, sourceUnit: "г/л" }),
    "Не указан",
  );
});
