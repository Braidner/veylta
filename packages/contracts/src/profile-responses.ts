/** Profile lifecycle responses: registration, listing, creation, archive and restore. */
import type {
  FAMILY_PROFILE_CONTRACT_VERSION,
  FamilySummary,
  PatientProfileKind,
  PatientProfileSummary,
  PROFILE_ARCHIVE_CONTRACT_VERSION,
} from "./index.js";

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

export interface ProfileArchiveResponse {
  readonly contractVersion: typeof PROFILE_ARCHIVE_CONTRACT_VERSION;
  readonly profileId: string;
  readonly archivedAt: string;
}

export interface ProfileRestoreResponse {
  readonly contractVersion: typeof PROFILE_ARCHIVE_CONTRACT_VERSION;
  readonly profileId: string;
  readonly restoredAt: string;
}

export interface ArchivedProfileSummary {
  readonly id: string;
  readonly familyId: string;
  readonly displayName: string;
  readonly kind: PatientProfileKind;
  readonly archivedAt: string;
}

export interface ArchivedProfileListResponse {
  readonly contractVersion: typeof PROFILE_ARCHIVE_CONTRACT_VERSION;
  readonly items: readonly ArchivedProfileSummary[];
}
