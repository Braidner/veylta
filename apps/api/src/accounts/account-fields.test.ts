import assert from "node:assert/strict";
import test from "node:test";
import { DomainValidationError } from "../family/family-service.js";
import { isValidUsername, normalizeUsername, validateAccountFields } from "./account-fields.js";

const valid = {
  username: "home-admin",
  displayName: "Домашний администратор",
  password: "correct horse battery staple",
};

test("a username is trimmed and lower-cased before it is judged", () => {
  assert.equal(normalizeUsername("  Home.Admin  "), "home.admin");
  assert.equal(isValidUsername("home.admin"), true);
  assert.equal(isValidUsername("a1_b-c.d"), true);
  assert.equal(isValidUsername("ab"), false, "shorter than three");
  assert.equal(isValidUsername("a".repeat(33)), false, "longer than thirty two");
  assert.equal(isValidUsername("-admin"), false, "starts with a separator");
  assert.equal(isValidUsername("Home-Admin"), false, "not normalized");
  assert.equal(isValidUsername("админ"), false);
});

test("the account's own fields are accepted or refused as one rule", () => {
  assert.doesNotThrow(() => validateAccountFields(valid));
  assert.doesNotThrow(() =>
    validateAccountFields({ ...valid, displayName: "И", password: "a".repeat(128) }),
  );
  assert.doesNotThrow(
    () => validateAccountFields({ ...valid, password: "и".repeat(120) }),
    "240 bytes is still within the byte bound",
  );
  for (const input of [
    { ...valid, username: "ab" },
    { ...valid, displayName: "" },
    { ...valid, displayName: "и".repeat(121) },
    { ...valid, password: "short pass" },
    { ...valid, password: "a".repeat(129) },
    // 100 characters, 300 bytes: within the character bound, past the byte bound.
    { ...valid, password: "€".repeat(100) },
  ]) {
    assert.throws(() => validateAccountFields(input), DomainValidationError);
  }
});
