import { VeyltaApp } from "../../../components/veylta-app";

/** `/<handle>/docs/<documentId>` — one source with its review, journal and dialogues. */
export default async function DocumentPage({
  params,
}: {
  params: Promise<{ handle: string; documentId: string }>;
}) {
  const { handle, documentId } = await params;
  return <VeyltaApp requestedHandle={handle} requestedDocumentId={documentId} />;
}
