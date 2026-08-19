import assert from "node:assert/strict";
import test from "node:test";
import {
  assistantAskPath,
  assistantPath,
  documentApiPath,
  documentPath,
  historyPath,
  loginPath,
  parseProfileTabSegment,
  profilePath,
  profileTabPath,
  settingsPath,
} from "./paths";

test("every browser path starts at the handle; tabs are segments; settings has two sections", () => {
  assert.equal(loginPath, "/login");
  assert.equal(profilePath("anna"), "/anna");
  assert.equal(profileTabPath("anna", "overview"), "/anna");
  assert.equal(profileTabPath("anna", "documents"), "/anna/docs");
  assert.equal(profileTabPath("anna", "history"), "/anna/history");
  assert.equal(profileTabPath("anna", "dossier"), "/anna/dossier");
  assert.equal(
    documentPath("anna", "00000000-0000-4000-8000-000000000001"),
    "/anna/docs/00000000-0000-4000-8000-000000000001",
  );
  assert.equal(assistantPath("anna", "physician"), "/anna/assistants/physician");
  assert.equal(
    assistantPath("anna", "trainer", "00000000-0000-4000-8000-000000000002"),
    "/anna/assistants/trainer?conversationId=00000000-0000-4000-8000-000000000002",
  );
  assert.equal(
    assistantAskPath("anna", "cardiologist"),
    "/anna/assistants/physician?ask=cardiologist",
  );
  assert.equal(settingsPath("anna", "user"), "/anna/settings");
  assert.equal(settingsPath("anna", "app"), "/anna/settings/app");
  assert.equal(historyPath("anna"), "/anna/history");
  assert.equal(historyPath("anna", "tsh"), "/anna/history?code=tsh");
  assert.equal(parseProfileTabSegment("docs"), "documents");
  assert.equal(parseProfileTabSegment("history"), "history");
  assert.equal(parseProfileTabSegment("dossier"), "dossier");
  assert.equal(parseProfileTabSegment(undefined), "overview");
  assert.equal(parseProfileTabSegment("plan"), "dossier");
});

test("API paths keep the family and profile ids — they are selectors, never links", () => {
  assert.equal(documentApiPath("f1", "p1", "d1"), "/v1/families/f1/profiles/p1/documents/d1");
});
