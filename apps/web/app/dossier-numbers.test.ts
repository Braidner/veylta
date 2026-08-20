import assert from "node:assert/strict";
import test from "node:test";
import { printedDelta, rangeBounds } from "./dossier-numbers";

const nothing = { low: null, high: null, lowText: null, highText: null };

test("a two-sided printed reference yields its bounds, kept in the source's spelling", () => {
  assert.deepEqual(rangeBounds("0,4 – 4,0"), {
    low: 0.4,
    high: 4,
    lowText: "0,4",
    highText: "4,0",
  });
  // What the laboratory printed after the bounds is the unit, never a third bound.
  assert.deepEqual(rangeBounds("5.0–8.0 synthetic-unit"), {
    low: 5,
    high: 8,
    lowText: "5.0",
    highText: "8.0",
  });
  assert.deepEqual(rangeBounds("120-160"), {
    low: 120,
    high: 160,
    lowText: "120",
    highText: "160",
  });
});

test("a sentence that is not two printed bounds has none, so nothing places a value", () => {
  for (const range of [null, "", "   ", "< 5,0", "отрицательно", "до 4,0", "0,4", "0,4 – норма"]) {
    assert.deepEqual(rangeBounds(range), nothing, range ?? "null");
  }
});

test("the delta is printed the way the latest value is", () => {
  assert.deepEqual(printedDelta({ printed: "6,5", value: 6.5 }, { printed: "4,4", value: 4.4 }), {
    value: "+2,1",
    direction: "increased",
  });
});
