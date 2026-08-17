"use client";

import type { AssistantEvidenceItem, AssistantEvidenceRef } from "@veylta/contracts";
import { ExternalLink } from "lucide-react";
import { documentPath } from "../paths";

export type EvidenceIndex = ReadonlyMap<string, AssistantEvidenceItem>;

/** Every ref opens the page the value was confirmed from; an unknown id is shown, not hidden. */
export function SourceRefs({
  refs,
  familyId,
  profileId,
  evidence,
}: {
  readonly refs: readonly AssistantEvidenceRef[];
  readonly familyId: string;
  readonly profileId: string;
  readonly evidence: EvidenceIndex;
}) {
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
            <a href={documentPath(familyId, profileId, item.documentId)}>
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
