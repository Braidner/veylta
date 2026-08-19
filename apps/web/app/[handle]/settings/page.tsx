import { VeyltaApp } from "../../components/veylta-app";

/** «Пользователь»: who is signed in and the family's profiles and access, opened on this person. */
export default async function SettingsPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <VeyltaApp requestedHandle={handle} requestedSettings requestedSettingsSection="user" />;
}
