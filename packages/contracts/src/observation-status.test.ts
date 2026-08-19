import assert from "node:assert/strict";
import test from "node:test";
import { isOutsideRange, numberOf, pointStatus } from "./observation-status.js";

test("printed numbers read with a comma or a dot; anything else is no number", () => {
  assert.equal(numberOf("6,8"), 6.8);
  assert.equal(numberOf(" 12.50 "), 12.5);
  assert.equal(numberOf("-0,4"), -0.4);
  assert.equal(numberOf("< 0,1"), null);
  assert.equal(numberOf("отр."), null);
  assert.equal(numberOf(null), null);
  assert.equal(numberOf(undefined), null);
});

test("status comes from the printed bounds, then from the laboratory's own flag, else unknown", () => {
  const range = (sourceLow: string | null, sourceHigh: string | null, flag: boolean | null) => ({
    sourceLow,
    sourceHigh,
    laboratoryOutOfRange: flag,
  });
  assert.equal(pointStatus(0.2, range("0,4", "4,0", null)), "below");
  assert.equal(pointStatus(9.9, range("0,4", "4,0", null)), "above");
  assert.equal(pointStatus(2.2, range("0,4", "4,0", null)), "within");
  assert.equal(pointStatus(9.9, range(null, "5", null)), "above", "one bound is enough");
  assert.equal(pointStatus(9.9, range(null, null, true)), "flagged");
  assert.equal(pointStatus(9.9, range(null, null, false)), "within");
  assert.equal(pointStatus(9.9, range(null, null, null)), "unknown");
  assert.equal(
    pointStatus(null, range(null, "5", null)),
    "unknown",
    "a comparison value has no number",
  );
  assert.equal(
    pointStatus(null, range(null, "5", true)),
    "flagged",
    "no number, but the laboratory said so",
  );
  assert.equal(pointStatus(9.9, null), "unknown");
  assert.deepEqual(
    ["above", "below", "flagged", "within", "unknown"].map((status) =>
      isOutsideRange(status as "above" | "below" | "flagged" | "within" | "unknown"),
    ),
    [true, true, true, false, false],
  );
});
