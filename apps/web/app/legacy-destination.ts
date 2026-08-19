import type { SessionResponse } from "@veylta/contracts";
import {
  assistantPath,
  documentPath,
  historyPath,
  parseAssistantId,
  parseProfileTabSegment,
  profileTabPath,
  settingsPath,
} from "./paths";

export interface LegacyTarget {
  readonly familyId?: string;
  readonly profileId?: string;
  readonly tab?: string;
  readonly documentId?: string;
  readonly assistantId?: string;
  readonly conversationId?: string;
  readonly ask?: string;
  readonly canonicalCode?: string;
  readonly settings?: "user" | "app";
}

/** Where an old `/families/…` or `/settings` link points now, given the session's profiles. */
export function legacyDestination(session: SessionResponse, target: LegacyTarget): string | null {
  const profiles = session.families.flatMap((family) => family.profiles);
  const profile =
    target.profileId === undefined
      ? profiles[0]
      : profiles.find((candidate) => candidate.id === target.profileId);
  if (profile === undefined) return null;
  const handle = profile.handle;
  if (target.settings !== undefined) return settingsPath(handle, target.settings);
  if (target.documentId !== undefined) return documentPath(handle, target.documentId);
  const assistantId = parseAssistantId(target.assistantId);
  if (assistantId !== undefined) {
    const base = assistantPath(handle, assistantId, target.conversationId ?? null);
    const separator = base.includes("?") ? "&" : "?";
    return target.ask === undefined
      ? base
      : `${base}${separator}ask=${encodeURIComponent(target.ask)}`;
  }
  const tab = parseProfileTabSegment(target.tab);
  if (tab === "history") return historyPath(handle, target.canonicalCode);
  return profileTabPath(handle, tab);
}

type Defined<T> = { [K in keyof T]: Exclude<T[K], undefined> };

/** Drops undefined fields so a target literal satisfies `exactOptionalPropertyTypes`. */
export function definedOnly<T extends object>(value: T): Defined<T> {
  const kept = Object.entries(value).filter(([, field]) => field !== undefined);
  return Object.fromEntries(kept) as Defined<T>;
}
