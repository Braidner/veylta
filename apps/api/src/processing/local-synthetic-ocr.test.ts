import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { createLocalSyntheticOcr } from "./local-synthetic-ocr.js";

test("the local synthetic OCR adapter exposes only the checked-in English model and never a provider URL", async () => {
  const ocr = createLocalSyntheticOcr();

  assert.deepEqual(ocr.capabilities(), {
    engine: "tesseract.js/7.0.0",
    language: "eng",
    network: "disabled",
  });
  await assert.rejects(
    ocr.recognize({ pageNumber: 1, png: Buffer.from("not a PNG") }),
    /INVALID_OCR_IMAGE/,
  );
});

test("the local adapter recognizes a bounded synthetic English scan without a network URL", async () => {
  const canvas = createCanvas(1_600, 500);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "black";
  context.font = "48px sans-serif";
  context.fillText("VEYLTA SYNTHETIC LAB REPORT v1", 60, 160);
  context.fillText("SYNTHETIC TEST DATA - NOT FOR MEDICAL USE", 60, 270);

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network access is forbidden");
  };
  let result: { confidence: number; text: string };
  try {
    result = await createLocalSyntheticOcr().recognize({
      pageNumber: 1,
      png: canvas.toBuffer("image/png"),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.match(result.text, /VEYLTA SYNTHETIC LAB REPORT v1/);
  assert.match(result.text, /SYNTHETIC TEST DATA — NOT FOR MEDICAL USE/);
  assert.equal(result.confidence >= 0 && result.confidence <= 1, true);
  assert.equal(fetchCalls, 0);
});
