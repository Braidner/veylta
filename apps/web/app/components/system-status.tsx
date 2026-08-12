"use client";

import type { HealthStatus } from "@veylta/contracts";
import { useEffect, useState } from "react";

type Status = "loading" | "ready" | "unavailable";

export function SystemStatus() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/health-api/readyz", { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as HealthStatus;
        setStatus(response.ok && body.status === "ok" ? "ready" : "unavailable");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setStatus("unavailable");
        }
      });
    return () => controller.abort();
  }, []);

  const copy = {
    loading: "Проверяем API и базу данных…",
    ready: "API и база данных готовы",
    unavailable: "API или база данных пока недоступны",
  } satisfies Record<Status, string>;

  return (
    <p className={`system-status system-status--${status}`} aria-live="polite">
      <span aria-hidden="true" />
      {copy[status]}
    </p>
  );
}
