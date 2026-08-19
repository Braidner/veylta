"use client";

import type { AssistantEvidenceItem, AssistantEvidenceRef } from "@veylta/contracts";
import { ExternalLink } from "lucide-react";
import { documentPath } from "../paths";
import { useProfileHandle } from "../profile-route";

export type EvidenceIndex = ReadonlyMap<string, AssistantEvidenceItem>;

/** Every ref opens the page the value was confirmed from; an unknown id is shown, not hidden. */
export function SourceRefs({
  refs,
  evidence,
}: {
  readonly refs: readonly AssistantEvidenceRef[];
  readonly evidence: EvidenceIndex;
}) {
  const handle = useProfileHandle();
  if (refs.length === 0) return null;
  return (
    <ul className="assistant-refs" aria-label="Источники">
      <li className="assistant-refs__label">Источники</li>
      {refs.map((ref) => {
        const item = evidence.get(ref.observationId);
        if (item === undefined) {
          return (
            <li key={ref.observationId} className="assistant-refs__missing">
              значение больше не подтверждено
            </li>
          );
        }
        return (
          <li key={ref.observationId}>
            <a href={documentPath(handle, item.documentId)}>
              <span>
                {item.name} {item.value} {item.unit}
              </span>
              <small>стр. {item.pageNumber}</small>
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
