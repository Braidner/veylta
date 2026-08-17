import {
  ASSISTANT_EGRESS_ACKNOWLEDGEMENT,
  type AssistantConversationPurpose,
  type AssistantSpecialty,
  type AssistantWorkspaceResponse,
} from "@veylta/contracts";
import { apiRequest } from "./api-client";

/** The assistant's API calls, one place: paths, idempotency headers and bodies. */
export function assistantEndpoint(familyId: string, profileId: string, assistantId: string) {
  return `/v1/families/${encodeURIComponent(familyId)}/profiles/${encodeURIComponent(profileId)}/assistants/${encodeURIComponent(assistantId)}`;
}

export function loadWorkspaceRequest(
  endpoint: string,
  conversationId: string | undefined,
  signal?: AbortSignal,
): Promise<AssistantWorkspaceResponse> {
  const query =
    conversationId === undefined ? "" : `?conversationId=${encodeURIComponent(conversationId)}`;
  return apiRequest<AssistantWorkspaceResponse>(
    `${endpoint}${query}`,
    signal === undefined ? undefined : { signal },
  );
}

export function createConversationRequest(
  endpoint: string,
  key: string,
  title: string,
  purpose: AssistantConversationPurpose | null = null,
) {
  return apiRequest<AssistantWorkspaceResponse>(`${endpoint}/conversations`, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify({ title, ...(purpose === null ? {} : { purpose }) }),
  });
}

export function acknowledgeRequest(endpoint: string, conversationId: string) {
  return apiRequest<AssistantWorkspaceResponse>(
    `${endpoint}/conversations/${encodeURIComponent(conversationId)}/acknowledgement`,
    {
      method: "PUT",
      body: JSON.stringify({ acknowledgement: ASSISTANT_EGRESS_ACKNOWLEDGEMENT }),
    },
  );
}

export function sendMessageRequest(
  endpoint: string,
  conversationId: string,
  key: string,
  message: string,
  addressee: AssistantSpecialty | null,
) {
  return apiRequest<AssistantWorkspaceResponse>(
    `${endpoint}/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({ message, ...(addressee === null ? {} : { addressee }) }),
    },
  );
}

export function conveneRequest(
  endpoint: string,
  conversationId: string,
  key: string,
  question: string | null,
) {
  return apiRequest<AssistantWorkspaceResponse>(
    `${endpoint}/conversations/${encodeURIComponent(conversationId)}/consilium`,
    {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({ question }),
    },
  );
}
