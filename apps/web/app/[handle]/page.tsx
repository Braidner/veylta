import { VeyltaApp } from "../components/veylta-app";

interface ProfilePageProps {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ tab?: string | string[]; canonicalCode?: string | string[] }>;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** `/<handle>` — the overview; an old `?tab=` or `?canonicalCode=` still lands where it pointed. */
export default async function ProfilePage({ params, searchParams }: ProfilePageProps) {
  const { handle } = await params;
  const { tab, canonicalCode } = await searchParams;
  return (
    <VeyltaApp
      requestedHandle={handle}
      requestedTab="overview"
      legacyTab={first(tab)}
      requestedCanonicalCode={first(canonicalCode)}
    />
  );
}
