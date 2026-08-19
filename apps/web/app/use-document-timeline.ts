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

/**
 * The timeline: the first page on mount and whenever `revision` changes, more on demand. What
 * `revision` counts is the caller's business — this hook only reloads when the number differs.
 */
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
    // The revision is a reload trigger, not a request field: it changes when what the timeline
    // holds can differ, and the first page is asked for again.
    void revision;
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload, revision]);

  /**
   * Older days appended to what is on screen. Every write goes through the current state: a
   * reload that lands while the page is in flight must not be overwritten by this snapshot.
   */
  async function loadMore(): Promise<void> {
    if (state.kind !== "ready" || state.nextBefore === null || state.loadingMore) return;
    const before = state.nextBefore;
    const settle = (page: DocumentTimelineResponse | null) => {
      setState((current) =>
        current.kind !== "ready"
          ? current
          : page === null
            ? { ...current, loadingMore: false }
            : {
                kind: "ready",
                entries: mergeTimelinePages(current.entries, page.entries),
                nextBefore: page.nextBefore,
                loadingMore: false,
              },
      );
    };
    setState((current) => (current.kind === "ready" ? { ...current, loadingMore: true } : current));
    try {
      settle(await apiRequest<DocumentTimelineResponse>(timelinePath(familyId, profileId, before)));
    } catch {
      settle(null);
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
