import assert from "node:assert/strict";
import test from "node:test";
import { countCopy, pluralForm } from "./russian-plural.js";

test("Russian counts agree with their nouns, including the teens and 21", () => {
  const forms = ["значение", "значения", "значений"] as const;
  assert.equal(countCopy(0, forms), "0 значений");
  assert.equal(countCopy(1, forms), "1 значение");
  assert.equal(countCopy(3, forms), "3 значения");
  assert.equal(countCopy(5, forms), "5 значений");
  assert.equal(countCopy(11, forms), "11 значений");
  assert.equal(countCopy(12, forms), "12 значений");
  assert.equal(countCopy(21, forms), "21 значение");
  assert.equal(countCopy(22, forms), "22 значения");
  assert.equal(countCopy(111, forms), "111 значений");
  assert.equal(pluralForm(1, ["ждёт", "ждут", "ждут"]), "ждёт");
  assert.equal(pluralForm(2, ["ждёт", "ждут", "ждут"]), "ждут");
});
