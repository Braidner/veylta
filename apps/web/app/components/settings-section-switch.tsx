"use client";

import Link from "next/link";
import { settingsPath } from "../paths";
import type { SettingsSection } from "../settings-sections";

const label: Record<SettingsSection, string> = { user: "Пользователь", app: "Приложение" };

/** «Пользователь» · «Приложение» — only the sections this session may open, the current one marked. */
export function SettingsSectionSwitch({
  sections,
  current,
  profileId,
}: {
  readonly sections: readonly SettingsSection[];
  readonly current: SettingsSection;
  readonly profileId: string | undefined;
}) {
  if (sections.length < 2) return null;
  return (
    <nav className="settings-sections" aria-label="Разделы настроек">
      {sections.map((section) => (
        <Link
          key={section}
          className={`settings-sections__item${section === current ? " is-current" : ""}`}
          href={settingsPath(section, profileId)}
          aria-current={section === current ? "page" : undefined}
        >
          {label[section]}
        </Link>
      ))}
    </nav>
  );
}
