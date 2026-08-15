import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentAgentConversationSummary, DocumentAgentRunSummary } from "@veylta/contracts";
import {
  activeDocumentAgentRunId,
  documentAgentConversationPreview,
  documentAgentRunPresentation,
} from "./document-agent-workspace.js";

test("conversation previews stay compact without losing an empty-thread state", () => {
  const conversation: DocumentAgentConversationSummary = {
    id: "00000000-0000-4000-8000-000000000001",
    title: "Разбор результатов",
    messageCount: 2,
    lastMessagePreview:
      "Очень длинное сообщение о данных документа, которое не должно раздвигать список тредов и ломать рабочую область.",
    lastMessageAt: "2026-08-15T10:00:00.000Z",
    createdAt: "2026-08-15T09:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
  };

  assert.equal(
    documentAgentConversationPreview(conversation, 48),
    "Очень длинное сообщение о данных документа, кот…",
  );
  assert.equal(
    documentAgentConversationPreview({ ...conversation, lastMessagePreview: null }, 48),
    "Диалог пока пуст",
  );
});

test("run presentation keeps processing state and ephemeral storage explicit", () => {
  const run: DocumentAgentRunSummary = {
    id: "00000000-0000-4000-8000-000000000002",
    title: "Первичный анализ",
    state: "completed",
    attemptCount: 1,
    createdAt: "2026-08-15T10:00:00.000Z",
    completedAt: "2026-08-15T10:00:18.000Z",
    ephemeral: true,
    provenance: {
      provider: "codex",
      modelId: "gpt-5.6-sol",
      runtimeVersion: "codex-cli 0.147.0",
    },
  };

  assert.deepEqual(documentAgentRunPresentation(run), {
    label: "Завершён за 18 с · временный",
    tone: "complete",
  });
  assert.deepEqual(documentAgentRunPresentation({ ...run, state: "running", completedAt: null }), {
    label: "Выполняется · временный",
    tone: "active",
  });
});

test("the active run falls back to the newest run unless an existing run is selected", () => {
  const run = (id: string): DocumentAgentRunSummary => ({
    id,
    title: "Повторный анализ",
    state: "completed",
    attemptCount: 1,
    createdAt: "2026-08-15T10:00:00.000Z",
    completedAt: "2026-08-15T10:00:18.000Z",
    ephemeral: true,
    provenance: null,
  });
  const oldest = "00000000-0000-4000-8000-000000000001";
  const newest = "00000000-0000-4000-8000-000000000002";
  // The workspace contract lists runs newest-first.
  const runs = [run(newest), run(oldest)];

  assert.equal(activeDocumentAgentRunId(runs, oldest), oldest);
  assert.equal(activeDocumentAgentRunId(runs, null), newest);
  assert.equal(activeDocumentAgentRunId(runs, "00000000-0000-4000-8000-00000000000f"), newest);
  assert.equal(activeDocumentAgentRunId([], oldest), null);
});
