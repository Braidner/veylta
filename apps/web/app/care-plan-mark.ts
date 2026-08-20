import type { CarePlanCheckinRequest, CarePlanItemResponse } from "@veylta/contracts";
import { apiRequest } from "./api-client";

/**
 * The person's mark for one day of an accepted regimen item. The plan page and the overview both
 * write through this one call, so the day, the body and the idempotent replay behave alike on both.
 */
export function recordCheckin(
  /** The item's own API path; the mark goes to `…/checkins/:date`. */
  itemPath: string,
  date: string,
  request: CarePlanCheckinRequest,
): Promise<CarePlanItemResponse> {
  return apiRequest<CarePlanItemResponse>(`${itemPath}/checkins/${date}`, {
    method: "PUT",
    body: JSON.stringify(request),
  });
}

/** The item's API path under a profile's care plan, as both surfaces build it. */
export function carePlanItemPath(carePlanPath: string, itemId: string): string {
  return `${carePlanPath}/items/${encodeURIComponent(itemId)}`;
}
