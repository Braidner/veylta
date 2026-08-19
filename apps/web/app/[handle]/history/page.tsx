import { VeyltaApp } from "../../components/veylta-app";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** `/<handle>/history?code=<code>` — the confirmed series; `?canonicalCode=` is the old spelling. */
export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ code?: string | string[]; canonicalCode?: string | string[] }>;
}) {
  const { handle } = await params;
  const { code, canonicalCode } = await searchParams;
  return (
    <VeyltaApp
      requestedHandle={handle}
      requestedTab="history"
      requestedCanonicalCode={first(code) ?? first(canonicalCode)}
    />
  );
}
