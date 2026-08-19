"use client";

import type { SessionResponse } from "@veylta/contracts";
import type { ReactNode } from "react";

const roleCopy: Record<string, string> = {
  admin: "Администратор системы",
  user: "Пользователь системы",
};

/**
 * «Пользователь»: who is signed in, and then the family's profiles and access as the child —
 * that panel stays in `veylta-app.tsx`, so this component never imports back into it.
 */
export function SettingsUserSection({
  session,
  children,
}: {
  readonly session: SessionResponse;
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
            {roleCopy[session.user.role ?? "user"] ?? "Пользователь системы"}
          </p>
        </div>
      </section>
      {children}
    </>
  );
}
