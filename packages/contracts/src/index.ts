export const HTTP_API_VERSION = "v1" as const;
export const OBJECT_STORAGE_CONTRACT_VERSION = "object-storage/v1" as const;
export const LAB_EXTRACTION_SCHEMA_VERSION = "lab-extraction/v1" as const;
export const FAMILY_PROFILE_CONTRACT_VERSION = "family-profile/v1" as const;
export const DOCUMENT_CONTRACT_VERSION = "document/v1" as const;
export const MAX_SYNTHETIC_PDF_BYTES = 5 * 1024 * 1024;

export interface HealthStatus {
  status: "ok" | "unavailable";
  service: "api" | "worker";
  version: string;
}

export type FamilyRole = "owner" | "adult_member" | "caregiver";
export type PatientProfileKind = "adult" | "dependent";

export interface FamilySummary {
  id: string;
  displayName: string;
  role: FamilyRole;
  createdAt: string;
}

export interface PatientProfileSummary {
  id: string;
  familyId: string;
  displayName: string;
  kind: PatientProfileKind;
  createdAt: string;
}

export interface DemoRegistrationRequest {
  displayName: string;
  familyName: string;
  profileName: string;
}

export interface DemoRegistrationResponse {
  contractVersion: typeof FAMILY_PROFILE_CONTRACT_VERSION;
  family: FamilySummary;
  profile: PatientProfileSummary;
}

export interface ProfileListResponse {
  contractVersion: typeof FAMILY_PROFILE_CONTRACT_VERSION;
  items: PatientProfileSummary[];
}

export interface ProfileCreateResponse {
  contractVersion: typeof FAMILY_PROFILE_CONTRACT_VERSION;
  profile: PatientProfileSummary;
}

export interface SessionFamily extends FamilySummary {
  profiles: PatientProfileSummary[];
}

export interface SessionResponse {
  contractVersion: typeof FAMILY_PROFILE_CONTRACT_VERSION;
  user: {
    id: string;
    displayName: string;
  };
  families: SessionFamily[];
}

export type DocumentStatus = "uploaded";

export interface DocumentSummary {
  id: string;
  familyId: string;
  profileId: string;
  status: DocumentStatus;
  originalFilename: string;
  contentType: "application/pdf";
  byteSize: number;
  sha256: string;
  uploadedAt: string;
  duplicate: {
    possible: boolean;
    documentId: string | null;
    profileId: string | null;
  };
  processing: {
    state: "not_started";
  };
}

export interface DocumentResponse {
  contractVersion: typeof DOCUMENT_CONTRACT_VERSION;
  document: DocumentSummary;
}
