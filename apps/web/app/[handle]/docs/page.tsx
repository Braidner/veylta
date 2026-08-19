import { VeyltaApp } from "../../components/veylta-app";

/** `/<handle>/docs` — the person's archive of sources. */
export default async function DocumentsPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <VeyltaApp requestedHandle={handle} requestedTab="documents" />;
}
