"use client";

import type { CarePlanItemResponse } from "@veylta/contracts";
import { useRef, useState } from "react";
import { apiRequest } from "./api-client";
import { referralItem } from "./assistant";
import type { ReferralBlock } from "./components/assistant-blocks";

/**
 * Accepting a referral block puts one clinician item into the care plan through the plan's own
 * endpoint; the item id is chosen once per block so a retry replays instead of duplicating.
 */
export function useReferralAcceptance(familyId: string, profileId: string) {
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const itemIds = useRef(new Map<string, string>());

  async function accept(key: string, block: ReferralBlock): Promise<void> {
    if (pending !== null) return;
    const itemId = itemIds.current.get(key) ?? crypto.randomUUID();
    itemIds.current.set(key, itemId);
    setPending(key);
    setError(null);
    try {
      await apiRequest<CarePlanItemResponse>(
        `/v1/families/${encodeURIComponent(familyId)}/profiles/${encodeURIComponent(profileId)}/care-plan/items/${itemId}`,
        { method: "PUT", body: JSON.stringify(referralItem(block)) },
      );
      setAccepted((current) => new Set([...current, key]));
    } catch {
      setError("Не удалось добавить пункт в план. Повторите попытку.");
    } finally {
      setPending(null);
    }
  }

  return { accepted, pending, error, accept };
}
