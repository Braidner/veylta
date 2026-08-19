"use client";

import { createContext, type ReactNode, useContext } from "react";

const ProfileRouteContext = createContext<string | null>(null);

/** The handle of the profile the page is about — what every link on the page is built from. */
export function ProfileRouteProvider({
  handle,
  children,
}: {
  readonly handle: string;
  readonly children: ReactNode;
}) {
  return <ProfileRouteContext.Provider value={handle}>{children}</ProfileRouteContext.Provider>;
}

export function useProfileHandle(): string {
  const handle = useContext(ProfileRouteContext);
  if (handle === null) throw new Error("useProfileHandle outside a ProfileRouteProvider");
  return handle;
}
