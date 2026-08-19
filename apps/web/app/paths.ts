import { ASSISTANT_IDS, type AssistantId } from "@veylta/contracts";
import type { SettingsSection } from "./settings-sections";

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

/** The `/assistants/:id` segment as one of the closed ids; anything else is no assistant. */
export function parseAssistantId(value: string | undefined): AssistantId | undefined {
  return (ASSISTANT_IDS as readonly string[]).includes(value ?? "")
    ? (value as AssistantId)
    : undefined;
}

export function assistantPath(
  familyId: string,
  profileId: string,
  assistantId: AssistantId,
  conversationId?: string | null,
): string {
  const base = `${profilePath(familyId, profileId)}/assistants/${encodeURIComponent(assistantId)}`;
  return conversationId === undefined || conversationId === null
    ? base
    : `${base}?conversationId=${encodeURIComponent(conversationId)}`;
}

/** The dossier's way in: the assistant page opens the conversation kept for this addressee. */
export function assistantAskPath(familyId: string, profileId: string, ask: string): string {
  return `${assistantPath(familyId, profileId, "physician")}?ask=${encodeURIComponent(ask)}`;
}

/** Settings as a page of their own: the section in the path, the profile to manage first in the query. */
export function settingsPath(section: SettingsSection, profileId?: string): string {
  const base = section === "app" ? "/settings/app" : "/settings";
  return profileId === undefined ? base : `${base}?profile=${encodeURIComponent(profileId)}`;
}
