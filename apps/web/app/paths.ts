import { ASSISTANT_IDS, type AssistantId, type AssistantSpecialty } from "@veylta/contracts";
import type { SettingsSection } from "./settings-sections";

/** The browser routes of a person; one place, so no surface spells a URL by hand. */
export const profileTabs = ["overview", "documents", "history", "dossier"] as const;
export type ProfileTab = (typeof profileTabs)[number];

export const loginPath = "/login";

const tabSegment: Record<ProfileTab, string> = {
  overview: "",
  documents: "/docs",
  history: "/history",
  dossier: "/dossier",
};

/** `/<handle>/<segment>` back to a tab; `plan` is the dossier's old name and still answers. */
export function parseProfileTabSegment(segment: string | undefined): ProfileTab {
  switch (segment) {
    case "docs":
    case "documents":
      return "documents";
    case "history":
      return "history";
    case "dossier":
    case "plan":
      return "dossier";
    default:
      return "overview";
  }
}

export function profilePath(handle: string): string {
  return `/${encodeURIComponent(handle)}`;
}

export function profileTabPath(handle: string, tab: ProfileTab): string {
  return `${profilePath(handle)}${tabSegment[tab]}`;
}

export function documentPath(handle: string, documentId: string): string {
  return `${profilePath(handle)}/docs/${encodeURIComponent(documentId)}`;
}

export function historyPath(handle: string, code?: string): string {
  const base = profileTabPath(handle, "history");
  return code === undefined ? base : `${base}?code=${encodeURIComponent(code)}`;
}

/** The `/assistants/:id` segment as one of the closed ids; anything else is no assistant. */
export function parseAssistantId(value: string | undefined): AssistantId | undefined {
  return (ASSISTANT_IDS as readonly string[]).includes(value ?? "")
    ? (value as AssistantId)
    : undefined;
}

export function assistantPath(
  handle: string,
  assistantId: AssistantId,
  conversationId?: string | null,
): string {
  const base = `${profilePath(handle)}/assistants/${encodeURIComponent(assistantId)}`;
  return conversationId === undefined || conversationId === null
    ? base
    : `${base}?conversationId=${encodeURIComponent(conversationId)}`;
}

/** The dossier's way in: the physician's room opens the conversation kept for this addressee. */
export function assistantAskPath(handle: string, ask: AssistantSpecialty | "consilium"): string {
  return `${assistantPath(handle, "physician")}?ask=${encodeURIComponent(ask)}`;
}

/** Settings as a page of this person: «Пользователь» by default, «Приложение» for an admin. */
export function settingsPath(handle: string, section: SettingsSection): string {
  return `${profilePath(handle)}/settings${section === "app" ? "/app" : ""}`;
}

/** API paths keep the family and profile ids — selectors for the server, never links for people. */
export function profileApiPath(familyId: string, profileId: string): string {
  return `/v1/families/${encodeURIComponent(familyId)}/profiles/${encodeURIComponent(profileId)}`;
}

export function documentApiPath(familyId: string, profileId: string, documentId: string): string {
  return `${profileApiPath(familyId, profileId)}/documents/${encodeURIComponent(documentId)}`;
}
