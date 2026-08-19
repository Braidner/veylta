import { VeyltaApp } from "../components/veylta-app";

interface SettingsPageProps {
  searchParams: Promise<{ profile?: string | string[] }>;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const { profile } = await searchParams;
  return (
    <VeyltaApp
      requestedSettings
      requestedSettingsSection="user"
      requestedSettingsProfileId={Array.isArray(profile) ? profile[0] : profile}
    />
  );
}
