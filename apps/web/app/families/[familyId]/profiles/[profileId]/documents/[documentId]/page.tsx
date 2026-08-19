import { LegacyRedirect } from "../../../../../../components/legacy-redirect";

/** The old id-based document link; the same source now lives at `/<handle>/docs/<documentId>`. */
export default async function LegacyDocumentPage({
  params,
}: {
  params: Promise<{ familyId: string; profileId: string; documentId: string }>;
}) {
  const { familyId, profileId, documentId } = await params;
  return <LegacyRedirect target={{ familyId, profileId, documentId }} />;
}
