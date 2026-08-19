import assert from "node:assert/strict";
import test from "node:test";
import { focusableWorkspaceTab, pageTitleFor } from "./workspace-header";

test("settings has no tab of its own; focus falls back to the first tab", () => {
  assert.equal(focusableWorkspaceTab("settings"), "overview");
  assert.equal(focusableWorkspaceTab("overview"), "overview");
  assert.equal(focusableWorkspaceTab("documents"), "documents");
  assert.equal(focusableWorkspaceTab("history"), "history");
  assert.equal(focusableWorkspaceTab("dossier"), "dossier");
});

test("the document title names the settings section while there, else the open profile", () => {
  assert.equal(pageTitleFor(true, "app", undefined), "Настройки сервера — Veylta");
  assert.equal(pageTitleFor(true, "user", undefined), "Настройки — Veylta");
  assert.equal(pageTitleFor(false, "user", { displayName: "Иван Петров" }), "Иван Петров — Veylta");
  assert.equal(pageTitleFor(false, "user", undefined), "Veylta");
});
