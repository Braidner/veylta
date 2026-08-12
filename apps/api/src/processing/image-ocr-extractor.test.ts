import assert from "node:assert/strict";
import test from "node:test";
import { createSyntheticLabImage } from "../../test/synthetic-lab-image.js";
import {
  extractImageTextWithLocalSyntheticOcr,
  LOCAL_SYNTHETIC_IMAGE_OCR_METHOD,
} from "./image-ocr-extractor.js";

const fixtureLines = [
  "VEYLTA SYNTHETIC LAB REPORT v1",
  "SYNTHETIC TEST DATA - NOT FOR MEDICAL USE",
  "FACT|synthetic-analyte-a",
  "NAME|SYNTHETIC ANALYTE A",
  "VALUE|7.0",
  "UNIT|synthetic-unit",
  "RANGE|synthetic reference",
  "CONFIDENCE|0.60",
  "ISSUES|AMBIGUOUS_UNIT",
  "END",
] as const;

for (const contentType of ["image/png", "image/jpeg"] as const) {
  test(`extracts a bounded direct ${contentType} fixture locally without network access`, async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("network access is forbidden");
    };
    try {
      const pages = await extractImageTextWithLocalSyntheticOcr(
        createSyntheticLabImage(fixtureLines, contentType === "image/png" ? "png" : "jpeg"),
        contentType,
      );
      assert.equal(pages.length, 1);
      assert.equal(pages[0]?.extractionMethod, LOCAL_SYNTHETIC_IMAGE_OCR_METHOD);
      assert.equal(pages[0]?.pageNumber, 1);
      assert.equal(pages[0]?.text.split("\n")[0], fixtureLines[0]);
      assert.equal(pages[0]?.text.split("\n")[1], "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE");
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("rejects a direct image whose declared type does not match its bytes", async () => {
  await assert.rejects(
    () =>
      extractImageTextWithLocalSyntheticOcr(
        createSyntheticLabImage(fixtureLines, "png"),
        "image/jpeg",
      ),
    /INVALID_IMAGE/,
  );
});

test("rejects an oversized PNG before image decoding", async () => {
  const oversizedHeader = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.alloc(4),
    Buffer.from("IHDR", "ascii"),
    Buffer.from([0, 0, 7, 209, 0, 0, 7, 209]),
  ]);
  await assert.rejects(
    () => extractImageTextWithLocalSyntheticOcr(oversizedHeader, "image/png"),
    /IMAGE_LIMIT_EXCEEDED/,
  );
});
