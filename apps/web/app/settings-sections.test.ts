import assert from "node:assert/strict";
import test from "node:test";
import { settingsPath } from "./paths";
import {
  defaultSettingsSection,
  parseSettingsSection,
  SETTINGS_SECTIONS,
  settingsSections,
} from "./settings-sections";

const owner = { user: { role: "user" }, families: [{ role: "owner" }] };
const admin = { user: { role: "admin" }, families: [{ role: "adult_member" }] };
const member = { user: { role: "user" }, families: [{ role: "adult_member" }] };

test("a family owner opens the user section only; an admin both; a member none", () => {
  assert.deepEqual(SETTINGS_SECTIONS, ["user", "app"]);
  assert.deepEqual(settingsSections(owner), ["user"]);
  assert.deepEqual(settingsSections(admin), ["user", "app"]);
  assert.deepEqual(settingsSections(member), []);
  assert.equal(defaultSettingsSection, "user");
});

test("the URL segment names the section; anything else is the user section", () => {
  assert.equal(parseSettingsSection("app"), "app");
  assert.equal(parseSettingsSection("user"), "user");
  assert.equal(parseSettingsSection(undefined), "user");
  assert.equal(parseSettingsSection("server"), "user");
});

test("the settings path carries the section and, when given, the profile to manage first", () => {
  assert.equal(settingsPath("user"), "/settings");
  assert.equal(settingsPath("app"), "/settings/app");
  assert.equal(
    settingsPath("user", "00000000-0000-4000-8000-000000000001"),
    "/settings?profile=00000000-0000-4000-8000-000000000001",
  );
  assert.equal(
    settingsPath("app", "00000000-0000-4000-8000-000000000001"),
    "/settings/app?profile=00000000-0000-4000-8000-000000000001",
  );
});
