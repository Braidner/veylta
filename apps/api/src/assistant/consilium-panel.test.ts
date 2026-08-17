import assert from "node:assert/strict";
import test from "node:test";
import { consiliumPanel } from "./consilium-panel.js";
import type { AssistantEvidence, AssistantObservation } from "./evidence.js";

function observation(observationId: string, code: string | null): AssistantObservation {
  return {
    observationId,
    code,
    name: code ?? "unknown",
    value: "1",
    unit: "u",
    referenceRange: null,
    sampledAt: null,
    laboratory: null,
  };
}

function evidence(
  observations: readonly AssistantObservation[],
  sex: "female" | "male" | null = "female",
): AssistantEvidence {
  return {
    medicalProfile: {
      interpretationReady: sex !== null,
      entries: sex === null ? [] : [{ kind: "sex", value: sex, recordedOn: null }],
    },
    observations,
    carePlan: [],
  };
}

test("thyroid values convene the endocrinologist and name the observations that did it", () => {
  const panel = consiliumPanel(
    evidence([observation("o1", "tsh"), observation("o2", "t4.free"), observation("o3", "crp")]),
  );
  assert.deepEqual(panel, [{ specialty: "endocrinologist", observationIds: ["o1", "o2"] }]);
});

test("the largest field comes first, ties follow the specialties' order, unknown codes invite nobody", () => {
  const panel = consiliumPanel(
    evidence([
      observation("h1", "hemoglobin"),
      observation("h2", "platelets"),
      observation("h3", "ferritin"),
      observation("k1", "creatinine"),
      observation("x", null),
      observation("y", "synthetic-analyte-a"),
      observation("z", "vitamin-d"),
    ]),
  );
  assert.deepEqual(
    panel.map((invitation) => [invitation.specialty, invitation.observationIds.length]),
    [
      ["hematologist", 3],
      ["nephrologist", 1],
    ],
  );
  const tie = consiliumPanel(evidence([observation("h", "hemoglobin"), observation("t", "tsh")]));
  assert.deepEqual(
    tie.map((invitation) => invitation.specialty),
    ["endocrinologist", "hematologist"],
  );
});

test("sex hormones go to the gynecologist, the urologist or the endocrinologist by the profile", () => {
  const hormones = [observation("e", "estradiol"), observation("f", "fsh")];
  assert.equal(consiliumPanel(evidence(hormones, "female"))[0]?.specialty, "gynecologist");
  assert.equal(consiliumPanel(evidence(hormones, "male"))[0]?.specialty, "urologist");
  assert.equal(consiliumPanel(evidence(hormones, null))[0]?.specialty, "endocrinologist");
});

test("the panel is capped at five specialists", () => {
  const panel = consiliumPanel(
    evidence([
      observation("1", "tsh"),
      observation("2", "cholesterol.ldl"),
      observation("3", "alt"),
      observation("4", "hemoglobin"),
      observation("5", "creatinine"),
      observation("6", "psa.total"),
    ]),
  );
  assert.equal(panel.length, 5);
});
