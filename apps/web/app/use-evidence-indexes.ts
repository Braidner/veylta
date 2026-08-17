"use client";

import type {
  AssistantEvidenceItem,
  AssistantEvidenceRecordItem,
  AssistantWorkspaceResponse,
} from "@veylta/contracts";
import { useMemo } from "react";

/** The workspace's evidence and records by id — how a block's refs find their sources. */
export function useEvidenceIndexes(workspace: AssistantWorkspaceResponse | null): {
  readonly evidence: ReadonlyMap<string, AssistantEvidenceItem>;
  readonly records: ReadonlyMap<string, AssistantEvidenceRecordItem>;
} {
  const evidence = useMemo(
    () => new Map((workspace?.evidence ?? []).map((item) => [item.observationId, item])),
    [workspace],
  );
  const records = useMemo(
    () => new Map((workspace?.records ?? []).map((item) => [item.recordId, item])),
    [workspace],
  );
  return { evidence, records };
}
