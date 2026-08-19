/**
 * A profile's handle: the one browser-facing name of a person — `/<handle>` is their page. Unique
 * across the whole server (the address carries no family), lower-case, short, never a word the
 * router already owns. The API keeps UUID paths; the handle is only for people and their links.
 */
export const MIN_PROFILE_HANDLE_LENGTH = 3;
export const MAX_PROFILE_HANDLE_LENGTH = 30;
export const PROFILE_HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

/** Top-level browser segments and well-known files a handle may not shadow. */
export const RESERVED_PROFILE_HANDLES: readonly string[] = [
  "login",
  "logout",
  "settings",
  "families",
  "profiles",
  "profile",
  "health-api",
  "api",
  "docs",
  "documents",
  "history",
  "dossier",
  "plan",
  "assistants",
  "app",
  "admin",
  "static",
  "_next",
  "manifest.webmanifest",
  "favicon.ico",
  "robots.txt",
];

export function isValidProfileHandle(value: string): boolean {
  return PROFILE_HANDLE_PATTERN.test(value) && !RESERVED_PROFILE_HANDLES.includes(value);
}

/** `PUT /v1/families/:familyId/profiles/:profileId/handle` */
export interface ProfileHandleRequest {
  readonly handle: string;
}

export interface ProfileHandleResponse {
  readonly contractVersion: "family-profile/v3";
  readonly profileId: string;
  readonly handle: string;
}
