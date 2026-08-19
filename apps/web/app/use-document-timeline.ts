"use client";

import type {
  DocumentDateRequest,
  DocumentDateResponse,
  DocumentTimelineEntry,
  DocumentTimelineResponse,
} from "@veylta/contracts";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api-client";
import { mergeTimelinePages } from "./document-timeline";
import { documentApiPath, profileApiPath } from "./paths";

/** Days per page the web asks for — a month of the record at a time. */
export const TIMELINE_PAGE_DAYS = 30;

export type DocumentTimelineState =
  | { kind: "loading" }
  | { kind: "error" }
  | {
      kind: "ready";
      entries: readonly DocumentTimelineEntry[];
      nextBefore: string | null;
      loadingMore: boolean;
    };

function timelinePath(familyId: string, profileId: string, before: string | null): string {
  const base = `${profileApiPath(familyId, profileId)}/documents/timeline?limit=${TIMELINE_PAGE_DAYS}`;
  return before === null ? base : `${base}&before=${encodeURIComponent(before)}`;
}

/** The timeline: first page on mount and whenever `revision` changes (a document left the queue), more on demand. */
export function useDocumentTimeline(input: {
  familyId: string;
  profileId: string;
  revision: number;
}) {
  const [state, setState] = useState<DocumentTimelineState>({ kind: "loading" });
  const { familyId, profileId, revision } = input;

  const reload = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const page = await apiRequest<DocumentTimelineResponse>(
          timelinePath(familyId, profileId, null),
          signal === undefined ? undefined : { signal },
        );
        if (!signal?.aborted) {
          setState({
            kind: "ready",
            entries: page.entries,
            nextBefore: page.nextBefore,
            loadingMore: false,
          });
        }
      } catch {
        if (!signal?.aborted) setState({ kind: "error" });
      }
    },
    [familyId, profileId],
  );

  useEffect(() => {
    // `revision` is the queue's size: a document that left the queue belongs in the timeline now,
    // so the first page is asked for again — the value itself is not part of the request.
    void revision;
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload, revision]);

  async function loadMore(): Promise<void> {
    if (state.kind !== "ready" || state.nextBefore === null || state.loadingMore) return;
    setState({ ...state, loadingMore: true });
    try {
      const page = await apiRequest<DocumentTimelineResponse>(
        timelinePath(familyId, profileId, state.nextBefore),
      );
      setState({
        kind: "ready",
        entries: mergeTimelinePages(state.entries, page.entries),
        nextBefore: page.nextBefore,
        loadingMore: false,
      });
    } catch {
      setState({ ...state, loadingMore: false });
    }
  }

  /** `PUT …/date`; the caller reloads so the node moves — throws on failure for the editor to show. */
  async function correctDate(documentId: string, documentDate: string | null): Promise<void> {
    const body: DocumentDateRequest = { documentDate };
    await apiRequest<DocumentDateResponse>(
      `${documentApiPath(familyId, profileId, documentId)}/date`,
      { method: "PUT", body: JSON.stringify(body) },
    );
    await reload();
  }

  return { state, reload, loadMore, correctDate };
}
