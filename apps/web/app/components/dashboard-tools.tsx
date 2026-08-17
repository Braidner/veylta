"use client";

import { FolderSearch, History, Maximize2 } from "lucide-react";
import Link from "next/link";

/** The overview's quick actions: find an indicator, back to top, open the history. */
export function DashboardTools({ historyHref }: { historyHref: string }) {
  return (
    <nav className="dashboard-tools" aria-label="Быстрые действия обзора">
      <Link
        href={`${historyHref}#indicator-catalog`}
        aria-label="Найти показатель"
        title="Найти показатель"
      >
        <FolderSearch size={19} aria-hidden="true" />
      </Link>
      <a href="#profile-dashboard" aria-label="Вернуться к началу обзора" title="Начало обзора">
        <Maximize2 size={19} aria-hidden="true" />
      </a>
      <Link href={historyHref} aria-label="Открыть историю" title="История">
        <History size={19} aria-hidden="true" />
      </Link>
    </nav>
  );
}
