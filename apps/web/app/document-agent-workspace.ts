import type { DocumentAgentConversationSummary, DocumentAgentRunSummary } from "@veylta/contracts";

export type DocumentAgentRunTone = "active" | "attention" | "complete" | "failed" | "pending";

export interface DocumentAgentRunPresentation {
  readonly label: string;
  readonly tone: DocumentAgentRunTone;
}

export function documentAgentConversationPreview(
  conversation: DocumentAgentConversationSummary,
  maxLength = 72,
): string {
  const preview = conversation.lastMessagePreview?.trim();
  if (!preview) return "Диалог пока пуст";
  if (preview.length <= maxLength) return preview;
  return `${preview.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

export function documentAgentRunPresentation(
  run: DocumentAgentRunSummary,
): DocumentAgentRunPresentation {
  const suffix = " · временный";

  if (run.state === "completed") {
    const duration = runDurationSeconds(run);
    return {
      label: duration === null ? `Завершён${suffix}` : `Завершён за ${duration} с${suffix}`,
      tone: "complete",
    };
  }
  if (run.state === "running") return { label: `Выполняется${suffix}`, tone: "active" };
  if (run.state === "retry_wait") {
    return { label: `Ожидает повтора${suffix}`, tone: "attention" };
  }
  if (run.state === "failed") return { label: `Не завершён${suffix}`, tone: "failed" };
  return { label: `В очереди${suffix}`, tone: "pending" };
}

function runDurationSeconds(run: DocumentAgentRunSummary): number | null {
  if (run.completedAt === null) return null;
  const startedAt = Date.parse(run.createdAt);
  const completedAt = Date.parse(run.completedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt)) return null;
  return Math.max(0, Math.round((completedAt - startedAt) / 1_000));
}
