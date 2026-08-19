import { VeyltaApp } from "../../components/veylta-app";

/** `/<handle>/dossier` — the cabinet a person shows their doctor. */
export default async function DossierPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <VeyltaApp requestedHandle={handle} requestedTab="dossier" />;
}
