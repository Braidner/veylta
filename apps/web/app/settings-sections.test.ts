import assert from "node:assert/strict";
import test from "node:test";
import { settingsPath } from "./paths";
import { SETTINGS_SECTIONS, settingsSections } from "./settings-sections";

const owner = { user: { role: "user" }, families: [{ role: "owner" }] };
const admin = { user: { role: "admin" }, families: [{ role: "adult_member" }] };
const member = { user: { role: "user" }, families: [{ role: "adult_member" }] };

test("a family owner opens the user section only; an admin both; a member none", () => {
  assert.deepEqual(SETTINGS_SECTIONS, ["user", "app"]);
  assert.deepEqual(settingsSections(owner), ["user"]);
  assert.deepEqual(settingsSections(admin), ["user", "app"]);
  assert.deepEqual(settingsSections(member), []);
});

test("settings is a page of the person the handle names; the section is the last segment", () => {
  assert.equal(settingsPath("anna", "user"), "/anna/settings");
  assert.equal(settingsPath("anna", "app"), "/anna/settings/app");
});
