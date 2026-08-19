import type { PatientProfileSummary } from "@veylta/contracts";
import type { ProfileTab } from "./paths";
import type { SettingsSection } from "./settings-sections";

/** The workspace header's tabs, plus the settings page which isn't one of them. */
export type WorkspaceTab = ProfileTab | "settings";

/**
 * A tablist always keeps exactly one tabbable item. Settings isn't one of the four profile
 * tabs, so keyboard focus falls back to the first while `aria-selected` still names none of them.
 */
export function focusableWorkspaceTab(activeTab: WorkspaceTab): ProfileTab {
  return activeTab === "settings" ? "overview" : activeTab;
}

/** The document title: the settings section while there, the open profile once one is, else the app name. */
export function pageTitleFor(
  requestedSettings: boolean,
  requestedSettingsSection: SettingsSection,
  profile: Pick<PatientProfileSummary, "displayName"> | undefined,
): string {
  if (requestedSettings) {
    return requestedSettingsSection === "app" ? "Настройки сервера — Veylta" : "Настройки — Veylta";
  }
  return profile === undefined ? "Veylta" : `${profile.displayName} — Veylta`;
}
