import { VeyltaApp } from "../../components/veylta-app";

interface SettingsAppPageProps {
  searchParams: Promise<{ profile?: string | string[] }>;
}

/** «Приложение»: the server an administrator runs — Codex, storage, accounts. */
export default async function SettingsAppPage({ searchParams }: SettingsAppPageProps) {
  const { profile } = await searchParams;
  return (
    <VeyltaApp
      requestedSettings
      requestedSettingsSection="app"
      requestedSettingsProfileId={Array.isArray(profile) ? profile[0] : profile}
    />
  );
}
