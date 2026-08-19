import assert from "node:assert/strict";
import test from "node:test";
import { parseProfileRoute } from "./profile-route-parse";

const at = (pathname: string, query = "") =>
  parseProfileRoute("anna", pathname, new URLSearchParams(query));

test("the overview is the handle alone; an old `?tab=` and `?canonicalCode=` travel with it", () => {
  assert.deepEqual(at("/anna"), { requestedHandle: "anna", requestedTab: "overview" });
  assert.deepEqual(at("/anna", "tab=history&canonicalCode=tsh"), {
    requestedHandle: "anna",
    requestedTab: "overview",
    legacyTab: "history",
    requestedCanonicalCode: "tsh",
  });
});

test("each tab is its own segment; `plan` is the dossier's old name and an unknown one is the overview", () => {
  assert.deepEqual(at("/anna/docs"), { requestedHandle: "anna", requestedTab: "documents" });
  assert.deepEqual(at("/anna/history"), { requestedHandle: "anna", requestedTab: "history" });
  assert.deepEqual(at("/anna/history", "code=tsh"), {
    requestedHandle: "anna",
    requestedTab: "history",
    requestedCanonicalCode: "tsh",
  });
  assert.deepEqual(at("/anna/history", "canonicalCode=tsh"), {
    requestedHandle: "anna",
    requestedTab: "history",
    requestedCanonicalCode: "tsh",
  });
  assert.deepEqual(at("/anna/dossier"), { requestedHandle: "anna", requestedTab: "dossier" });
  assert.deepEqual(at("/anna/plan"), { requestedHandle: "anna", requestedTab: "dossier" });
  assert.deepEqual(at("/anna/nowhere"), { requestedHandle: "anna", requestedTab: "overview" });
});

test("a document and an assistant are detail views: no tab, the id from the path", () => {
  assert.deepEqual(at("/anna/docs/d-1"), {
    requestedHandle: "anna",
    requestedDocumentId: "d-1",
  });
  assert.deepEqual(at("/anna/assistants/physician"), {
    requestedHandle: "anna",
    requestedAssistantId: "physician",
  });
  assert.deepEqual(at("/anna/assistants/trainer", "conversationId=c-1&ask=cardiologist"), {
    requestedHandle: "anna",
    requestedAssistantId: "trainer",
    requestedConversationId: "c-1",
    requestedAssistantAsk: "cardiologist",
  });
});

test("settings is a page of this person, its section the last segment", () => {
  assert.deepEqual(at("/anna/settings"), {
    requestedHandle: "anna",
    requestedSettings: true,
    requestedSettingsSection: "user",
  });
  assert.deepEqual(at("/anna/settings/app"), {
    requestedHandle: "anna",
    requestedSettings: true,
    requestedSettingsSection: "app",
  });
});

test("the handle comes from the route, never from the pathname's own spelling", () => {
  const route = parseProfileRoute("anna", "/Anna/docs/d%201", new URLSearchParams());
  assert.deepEqual(route, { requestedHandle: "anna", requestedDocumentId: "d 1" });
});

test("a malformed percent-escape does not throw; the raw segment flows through", () => {
  assert.deepEqual(at("/anna/docs/%"), { requestedHandle: "anna", requestedDocumentId: "%" });
});
