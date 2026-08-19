"use client";

import Link from "next/link";
import { settingsPath } from "../paths";
import { useProfileHandle } from "../profile-route";
import type { SettingsSection } from "../settings-sections";

const label: Record<SettingsSection, string> = { user: "Пользователь", app: "Приложение" };

/** «Пользователь» · «Приложение» — only the sections this session may open, the current one marked. */
export function SettingsSectionSwitch({
  sections,
  current,
}: {
  readonly sections: readonly SettingsSection[];
  readonly current: SettingsSection;
}) {
  const handle = useProfileHandle();
  if (sections.length < 2) return null;
  return (
    <nav className="settings-sections" aria-label="Разделы настроек">
      {sections.map((section) => (
        <Link
          key={section}
          className={`settings-sections__item${section === current ? " is-current" : ""}`}
          href={settingsPath(handle, section)}
          aria-current={section === current ? "page" : undefined}
        >
          {label[section]}
        </Link>
      ))}
    </nav>
  );
}
