import assert from "node:assert/strict";
import test from "node:test";
import { DomainValidationError } from "../family/family-service.js";
import { medicalProfileEntryValue } from "./medical-profile-values.js";

test("closed and numeric kinds are validated, free text is kept as typed", () => {
  assert.equal(medicalProfileEntryValue("sex", " female "), "female");
  assert.throws(() => medicalProfileEntryValue("sex", "unknown"), DomainValidationError);
  assert.equal(medicalProfileEntryValue("pregnancy", "lactating"), "lactating");
  assert.equal(medicalProfileEntryValue("birth_year", "1992"), "1992");
  assert.throws(() => medicalProfileEntryValue("birth_year", "1850"), DomainValidationError);
  assert.throws(() => medicalProfileEntryValue("birth_year", "3000"), DomainValidationError);
  assert.throws(() => medicalProfileEntryValue("birth_year", "1992.5"), DomainValidationError);
  assert.equal(medicalProfileEntryValue("height_cm", "178"), "178");
  assert.equal(medicalProfileEntryValue("weight_kg", "72,5"), "72.5");
  assert.throws(() => medicalProfileEntryValue("weight_kg", "0"), DomainValidationError);
  assert.equal(
    medicalProfileEntryValue("medication", "  Синтетический препарат A,   1 таблетка утром "),
    "Синтетический препарат A, 1 таблетка утром",
  );
  assert.throws(() => medicalProfileEntryValue("note", "   "), DomainValidationError);
  assert.throws(() => medicalProfileEntryValue("note", "x".repeat(301)), DomainValidationError);
});
