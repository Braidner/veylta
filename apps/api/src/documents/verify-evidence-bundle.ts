import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  MAX_SYNTHETIC_EVIDENCE_BUNDLE_ARCHIVE_BYTES,
  verifySyntheticEvidenceBundle,
} from "./evidence-bundle-verifier.js";

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

export async function verifyEvidenceBundleFile(path: string): Promise<{
  contractVersion: string;
  documentCount: number;
  observationCount: number;
}> {
  const handle = await open(path, "r");
  try {
    const details = await handle.stat();
    if (
      !details.isFile() ||
      details.size <= 0 ||
      details.size > MAX_SYNTHETIC_EVIDENCE_BUNDLE_ARCHIVE_BYTES
    ) {
      throw new Error("Evidence bundle verification failed");
    }
    const snapshot = Buffer.allocUnsafe(details.size + 1);
    let offset = 0;
    while (offset < snapshot.byteLength) {
      const { bytesRead } = await handle.read(
        snapshot,
        offset,
        snapshot.byteLength - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== details.size) throw new Error("Evidence bundle verification failed");
    if ((await handle.stat()).size !== details.size) {
      throw new Error("Evidence bundle verification failed");
    }
    return verifySyntheticEvidenceBundle(snapshot.subarray(0, offset));
  } finally {
    await handle.close();
  }
}

if (isMain) {
  const path = process.argv[2];
  if (typeof path !== "string" || process.argv.length !== 3) {
    console.error("Usage: pnpm --filter @veylta/api verify:evidence-bundle <bundle.tar>");
    process.exitCode = 2;
  } else {
    verifyEvidenceBundleFile(path).then(
      (result) => {
        console.log(
          `Evidence bundle verified (${result.contractVersion}): ${result.documentCount} sources, ${result.observationCount} observations.`,
        );
      },
      () => {
        console.error("Evidence bundle verification failed.");
        process.exitCode = 1;
      },
    );
  }
}
