export const HTTP_API_VERSION = "v1" as const;
export const OBJECT_STORAGE_CONTRACT_VERSION = "object-storage/v1" as const;
export const LAB_EXTRACTION_SCHEMA_VERSION = "lab-extraction/v1" as const;

export interface HealthStatus {
  status: "ok" | "unavailable";
  service: "api" | "worker";
  version: string;
}
