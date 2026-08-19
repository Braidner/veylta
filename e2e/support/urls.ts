/**
 * A person's own page is `/<handle>` — exactly one path segment, and never the sign-in door.
 * Anchored on purpose: an unanchored `/[a-z0-9-]+$/` also matches `/<handle>/docs`, so a spec
 * waiting for the overview would pass while still on a tab.
 */
export const profileHandleUrl = /^http:\/\/[^/]+\/(?!login$)[a-z0-9-]+$/;
