/** The browser routes of a profile; one place, so no surface spells a URL by hand. */
export const profileTabs = ["overview", "documents", "history", "dossier"] as const;
export type ProfileTab = (typeof profileTabs)[number];

/** Older links say `plan`; the tab is the dossier now and still answers to the old name. */
export function normalizeProfileTab(value: string | undefined): ProfileTab {
  if (value === "plan") return "dossier";
  return profileTabs.includes(value as ProfileTab) ? (value as ProfileTab) : "overview";
}

export function profilePath(familyId: string, profileId: string): string {
  return `/families/${encodeURIComponent(familyId)}/profiles/${encodeURIComponent(profileId)}`;
}

export function profileTabPath(familyId: string, profileId: string, tab: ProfileTab): string {
  const base = profilePath(familyId, profileId);
  return tab === "overview" ? base : `${base}?tab=${tab}`;
}

export function documentPath(familyId: string, profileId: string, documentId: string): string {
  return `${profilePath(familyId, profileId)}/documents/${encodeURIComponent(documentId)}`;
}

export function assistantPath(
  familyId: string,
  profileId: string,
  assistantId: string,
  conversationId?: string | null,
): string {
  const base = `${profilePath(familyId, profileId)}/assistants/${encodeURIComponent(assistantId)}`;
  return conversationId === undefined || conversationId === null
    ? base
    : `${base}?conversationId=${encodeURIComponent(conversationId)}`;
}
