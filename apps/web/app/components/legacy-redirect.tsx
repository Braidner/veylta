"use client";

import type { SessionResponse } from "@veylta/contracts";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ApiError, apiRequest } from "../api-client";
import { type LegacyTarget, legacyDestination } from "../legacy-destination";
import { loginPath } from "../paths";

/** Renders nothing; replaces the URL once the session is known, or sends to /login. */
export function LegacyRedirect({ target }: { readonly target: LegacyTarget }) {
  const router = useRouter();
  useEffect(() => {
    let active = true;
    apiRequest<SessionResponse>("/v1/session")
      .then((session) => {
        if (!active) return;
        router.replace(legacyDestination(session, target) ?? "/");
      })
      .catch((error: unknown) => {
        if (!active) return;
        router.replace(error instanceof ApiError && error.status === 401 ? loginPath : "/");
      });
    return () => {
      active = false;
    };
  }, [router, target]);
  return null;
}
