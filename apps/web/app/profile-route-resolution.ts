import type { PatientProfileSummary, SessionFamily, SessionResponse } from "@veylta/contracts";
import {
  historyPath,
  loginPath,
  parseProfileTabSegment,
  profilePath,
  profileTabPath,
} from "./paths";

/** The person a `/<handle>` route is about; the handle is the name, so case is not part of it. */
export function findProfileByHandle(
  session: SessionResponse,
  handle: string,
): { family: SessionFamily; profile: PatientProfileSummary } | undefined {
  const wanted = handle.toLowerCase();
  for (const family of session.families) {
    const profile = family.profiles.find((candidate) => candidate.handle.toLowerCase() === wanted);
    if (profile !== undefined) return { family, profile };
  }
  return undefined;
}

export interface EntryRoute {
  readonly session: SessionResponse | null;
  /** The `/<handle>` this page is about; absent at `/` and `/login`. */
  readonly requestedHandle: string | undefined;
  readonly requestedLogin: boolean;
  /** An old `?tab=` on `/<handle>`; the tab is a segment of its own now. */
  readonly legacyTab: string | undefined;
  /** The indicator an old `?canonicalCode=` asked for; it travels to the history's own `?code=`. */
  readonly legacyCanonicalCode?: string | undefined;
}

/**
 * Where the app sends the browser once the session is known, or null to stay. A doorway (`/`,
 * `/login` with a session) opens the first profile; an unknown handle stays and says so, so no
 * link ever bounces between two screens.
 */
export function entryRedirect({
  session,
  requestedHandle,
  requestedLogin,
  legacyTab,
  legacyCanonicalCode,
}: EntryRoute): string | null {
  if (session === null) return requestedLogin ? null : loginPath;
  if (requestedLogin || requestedHandle === undefined) {
    const first = session.families.flatMap((family) => family.profiles)[0];
    return first === undefined ? null : profilePath(first.handle);
  }
  const found = findProfileByHandle(session, requestedHandle);
  const tab = parseProfileTabSegment(legacyTab);
  if (found === undefined || tab === "overview") return null;
  const handle = found.profile.handle;
  return tab === "history" ? historyPath(handle, legacyCanonicalCode) : profileTabPath(handle, tab);
}
