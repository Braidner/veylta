import { createRequire } from "node:module";
import Tesseract from "tesseract.js";

const require = createRequire(import.meta.url);
const englishData = require("@tesseract.js-data/eng") as {
  code: string;
  gzip: boolean;
  langPath: string;
};

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const maximumPngBytes = 8 * 1024 * 1024;
export const MAXIMUM_LOCAL_SYNTHETIC_OCR_PIXELS = 2_000_000;
const maximumRecognizedCharacters = 250_000;
const recognitionTimeoutMs = 30_000;
const canonicalFixtureDisclaimer = "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE";
const syntheticFieldSeparator = /^(FACT|NAME|VALUE|UNIT|RANGE|CONFIDENCE|ISSUES)\s*\]?\s*\|\s*/;
const spacedConfidence = /^(CONFIDENCE\|[01])\.\s+(\d{1,4})$/;
const spacedIssue =
  /^(ISSUES\|)(LOW CONFIDENCE|AMBIGUOUS UNIT|MISSING UNIT|INVALID VALUE|INVALID DATE|INVALID REFERENCE RANGE|UNSUPPORTED ANALYTE)$/;

export const LOCAL_SYNTHETIC_OCR_ENGINE = "tesseract.js/7.0.0" as const;
export const LOCAL_SYNTHETIC_OCR_LANGUAGE = "eng" as const;

export interface OcrImage {
  pageNumber: number;
  png: Uint8Array;
}

export interface LocalSyntheticOcrCapabilities {
  engine: typeof LOCAL_SYNTHETIC_OCR_ENGINE;
  language: typeof LOCAL_SYNTHETIC_OCR_LANGUAGE;
  network: "disabled";
}

export interface LocalSyntheticOcr {
  capabilities(): LocalSyntheticOcrCapabilities;
  recognize(input: OcrImage): Promise<{ confidence: number; text: string }>;
}

export type LocalSyntheticOcrErrorCode = "INVALID_OCR_IMAGE" | "OCR_LIMIT_EXCEEDED" | "OCR_FAILED";

export class LocalSyntheticOcrError extends Error {
  constructor(readonly code: LocalSyntheticOcrErrorCode) {
    super(code);
    this.name = "LocalSyntheticOcrError";
  }
}

function validPng(input: OcrImage): void {
  const bytes = Buffer.from(input.png.buffer, input.png.byteOffset, input.png.byteLength);
  if (
    !Number.isSafeInteger(input.pageNumber) ||
    input.pageNumber < 1 ||
    input.pageNumber > 50 ||
    input.png.byteLength < 24 ||
    input.png.byteLength > maximumPngBytes ||
    !bytes.subarray(0, pngSignature.byteLength).equals(pngSignature) ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new LocalSyntheticOcrError(
      input.png.byteLength > maximumPngBytes ? "OCR_LIMIT_EXCEEDED" : "INVALID_OCR_IMAGE",
    );
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width * height > MAXIMUM_LOCAL_SYNTHETIC_OCR_PIXELS) {
    throw new LocalSyntheticOcrError(
      width * height > MAXIMUM_LOCAL_SYNTHETIC_OCR_PIXELS
        ? "OCR_LIMIT_EXCEEDED"
        : "INVALID_OCR_IMAGE",
    );
  }
}

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new LocalSyntheticOcrError("OCR_LIMIT_EXCEEDED")),
          recognitionTimeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function normalizeLocalSyntheticOcrText(value: unknown): string {
  if (typeof value !== "string") throw new LocalSyntheticOcrError("OCR_FAILED");
  const text = value
    .normalize("NFC")
    .replaceAll("\r\n", "\n")
    .replace(/\n{2,}/g, "\n")
    // OCR consistently substitutes this one typographic dash in the fixed fixture header.
    // Normalize only the whole known line; all other grammar remains fail-closed.
    .replace(/^SYNTHETIC TEST DATA - NOT FOR MEDICAL USE$/gm, canonicalFixtureDisclaimer)
    .split("\n")
    .map((line) =>
      line
        // The fixed-field synthetic grammar is OCRed with small layout differences
        // across supported platforms. Normalize whitespace and one stray `]` only at
        // its static separators; values keep the parser's strict validation.
        .replace(syntheticFieldSeparator, "$1|")
        // Linux Tesseract may split the only decimal literal accepted by the grammar.
        .replace(spacedConfidence, "$1.$2")
        // The finite issue enum is written with underscores by the fixture grammar.
        .replace(
          spacedIssue,
          (_, prefix: string, issue: string) => `${prefix}${issue.replaceAll(" ", "_")}`,
        ),
    )
    .join("\n")
    .trim();
  if (text.length === 0 || text.length > maximumRecognizedCharacters) {
    throw new LocalSyntheticOcrError(
      text.length > maximumRecognizedCharacters ? "OCR_LIMIT_EXCEEDED" : "OCR_FAILED",
    );
  }
  return text;
}

function confidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new LocalSyntheticOcrError("OCR_FAILED");
  }
  return value / 100;
}

export function createLocalSyntheticOcr(): LocalSyntheticOcr {
  if (
    englishData.code !== LOCAL_SYNTHETIC_OCR_LANGUAGE ||
    englishData.gzip !== true ||
    typeof englishData.langPath !== "string" ||
    englishData.langPath.length === 0
  ) {
    throw new Error("The locked local English OCR model is unavailable");
  }

  return {
    capabilities: () => ({
      engine: LOCAL_SYNTHETIC_OCR_ENGINE,
      language: LOCAL_SYNTHETIC_OCR_LANGUAGE,
      network: "disabled",
    }),

    async recognize(input) {
      validPng(input);
      let worker: Tesseract.Worker | undefined;
      let creation: Promise<Tesseract.Worker> | undefined;
      try {
        creation = Tesseract.createWorker(LOCAL_SYNTHETIC_OCR_LANGUAGE, Tesseract.OEM.LSTM_ONLY, {
          cacheMethod: "none",
          gzip: true,
          langPath: englishData.langPath,
          logger: () => undefined,
        });
        worker = await bounded(creation);
        await bounded(
          worker.setParameters({
            tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
          }),
        );
        const output = await bounded(worker.recognize(Buffer.from(input.png)));
        return {
          confidence: confidence(output.data.confidence),
          text: normalizeLocalSyntheticOcrText(output.data.text),
        };
      } catch (error) {
        if (error instanceof LocalSyntheticOcrError) throw error;
        throw new LocalSyntheticOcrError("OCR_FAILED");
      } finally {
        if (worker !== undefined) {
          await worker.terminate().catch(() => undefined);
        } else if (creation !== undefined) {
          // A timeout may win before worker initialization settles. Ensure a late
          // worker cannot retain a process or temporary cache in the background.
          void creation.then(
            (lateWorker) => lateWorker.terminate().catch(() => undefined),
            () => undefined,
          );
        }
      }
    },
  };
}
