"use client";

import type { AppAccountRole, PatientProfileSummary, SessionResponse } from "@veylta/contracts";
import type { ReactNode } from "react";
import { ProfileHandleForm } from "./profile-handle-form";

const roleCopy: Record<AppAccountRole, string> = {
  admin: "Администратор системы",
  user: "Пользователь системы",
};

/**
 * «Пользователь»: who is signed in, then that person's own address (when they may set one),
 * then the family's profiles and access as the child — that panel stays in `veylta-app.tsx`, so
 * this component never imports back into it.
 */
export function SettingsUserSection({
  session,
  managedProfile,
  canRename,
  onSessionRefresh,
  children,
}: {
  readonly session: SessionResponse;
  /** The profile of the page's own person (the URL's handle), not the family switcher below. */
  readonly managedProfile: PatientProfileSummary | null;
  readonly canRename: boolean;
  readonly onSessionRefresh: () => Promise<void>;
  readonly children: ReactNode;
}) {
  return (
    <>
      <section className="settings-identity" aria-labelledby="settings-identity-title">
        <div className="settings-section-heading">
          <div>
            <p className="section-label">Учётная запись</p>
            <h2 id="settings-identity-title">{session.user.displayName}</h2>
          </div>
          <p>
            {session.user.username === null ? "демо-сессия" : `@${session.user.username}`} ·{" "}
            {roleCopy[session.user.role ?? "user"]}
          </p>
        </div>
      </section>
      {managedProfile !== null && canRename ? (
        <ProfileHandleForm profile={managedProfile} onSaved={onSessionRefresh} />
      ) : null}
      {children}
    </>
  );
}
