"use client";

import type { SessionResponse } from "@veylta/contracts";
import { Settings } from "lucide-react";
import Link from "next/link";
import { canOpenSettings } from "../account-access";
import { settingsPath } from "../paths";

/**
 * Settings as a gear where the server chip used to sit: for a family owner it opens this person's
 * settings, for an administrator the same page with the application section within reach; for
 * anyone else nothing — the spot stays empty, the rule stays `canOpenSettings`.
 */
export function SettingsGear({
  session,
  profileId,
}: {
  readonly session: SessionResponse;
  readonly profileId: string | undefined;
}) {
  if (!canOpenSettings(session)) return null;
  return (
    <Link
      className="workspace-icon-action workspace-gear"
      href={settingsPath("user", profileId)}
      aria-label="Настройки"
      title="Настройки"
      data-testid="settings-gear"
    >
      <Settings size={19} aria-hidden="true" />
    </Link>
  );
}
