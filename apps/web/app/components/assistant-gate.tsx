"use client";

import type { AssistantWorkspaceResponse } from "@veylta/contracts";
import { egressDisclosure } from "../assistant";

/** Nothing leaves the machine until a member reads exactly what will be sent and confirms it. */
export function EgressGate({
  workspace,
  canWrite,
  pending,
  onAcknowledge,
}: {
  readonly workspace: AssistantWorkspaceResponse;
  readonly canWrite: boolean;
  readonly pending: boolean;
  readonly onAcknowledge: () => void;
}) {
  return (
    <div className="assistant-gate" data-testid="assistant-egress-gate">
      <h5>Что уйдёт в Codex вместе с вашим вопросом</h5>
      <ul>
        {egressDisclosure(workspace).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p>
        Исходные документы, их страницы и файлы не отправляются. Учётные данные Codex остаются у
        Codex. Ответ проверяется вторым независимым запуском и показывается только после этого.
      </p>
      {canWrite ? (
        <button
          type="button"
          className="button button--primary"
          onClick={onAcknowledge}
          disabled={pending}
        >
          {pending ? "Подтверждаем…" : "Подтвердить и продолжить"}
        </button>
      ) : (
        <p className="assistant-gate__readonly">Подтвердить отправку может владелец профиля.</p>
      )}
    </div>
  );
}
