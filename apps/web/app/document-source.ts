import type { SyntheticDocumentContentType } from "@veylta/contracts";

/** «PDF», «PNG», «JPEG» — one reading of a source's format for every surface. */
export function documentKindLabel(contentType: SyntheticDocumentContentType): string {
  switch (contentType) {
    case "application/pdf":
      return "PDF";
    case "image/png":
      return "PNG";
    case "image/jpeg":
      return "JPEG";
  }
}
