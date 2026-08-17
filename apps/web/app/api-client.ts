/** The browser never calls the API port; Next.js rewrites this prefix to API_INTERNAL_URL. */
export const apiPrefix = "/health-api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (
    init?.body !== undefined &&
    !(init.body instanceof FormData) &&
    !headers.has("content-type")
  ) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${apiPrefix}${path}`, {
    ...init,
    credentials: "same-origin",
    headers,
  });

  if (!response.ok) {
    let code: string | null = null;
    try {
      const body = (await response.json()) as { error?: { code?: unknown } };
      if (typeof body.error?.code === "string") code = body.error.code;
    } catch {
      // The status remains authoritative when an intermediary returns no JSON envelope.
    }
    throw new ApiError(response.status, code);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
