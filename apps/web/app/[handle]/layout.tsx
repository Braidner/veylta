"use client";

import { useParams, usePathname, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { LoadingScreen } from "../components/loading-screen";
import { VeyltaApp } from "../components/veylta-app";
import { parseProfileRoute } from "../profile-route-parse";

/**
 * The shell of one person, mounted once for `/<handle>` and every route under it: a tab click
 * changes the app's props, so the session is read once and no interstitial flashes between tabs.
 */
function ProfileShell() {
  const params = useParams<{ handle: string | string[] }>();
  const handle = Array.isArray(params.handle) ? params.handle[0] : params.handle;
  const pathname = usePathname();
  const search = useSearchParams();
  if (handle === undefined) return null;
  return <VeyltaApp {...parseProfileRoute(handle, pathname, search)} />;
}

/** Every page below is empty by design; the routes exist, this layout renders them. */
export default function ProfileLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <ProfileShell />
      {children}
    </Suspense>
  );
}
