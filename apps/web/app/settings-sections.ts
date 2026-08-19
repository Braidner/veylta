import { canOpenSettings } from "./account-access";

/** The two faces of settings: this person and their family, and the server an admin runs. */
export const SETTINGS_SECTIONS = ["user", "app"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Which sections a session may open: the user section for anyone who may open settings at all. */
export function settingsSections(session: {
  readonly user: { readonly role: string | null };
  readonly families: ReadonlyArray<{ readonly role: string | null }>;
}): SettingsSection[] {
  if (!canOpenSettings(session)) return [];
  return session.user.role === "admin" ? ["user", "app"] : ["user"];
}
