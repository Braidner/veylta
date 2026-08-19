import { VeyltaApp } from "../../../components/veylta-app";

/** «Приложение»: the server an administrator runs — Codex, storage, accounts. */
export default async function SettingsAppPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <VeyltaApp requestedHandle={handle} requestedSettings requestedSettingsSection="app" />;
}
