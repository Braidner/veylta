import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_PAGE_TEXT_LAYER_METHOD,
  DOCUMENT_PAGE_VISION_METHOD,
  type DocumentPageUnreadReason,
} from "@veylta/contracts";
import { type DocumentPageReadingWrite, pageWriteDecision } from "./document-page-rows.js";

function textLayer(
  text: string,
  unreadReason: DocumentPageUnreadReason | null = null,
): DocumentPageReadingWrite {
  return {
    text,
    extractionMethod: DOCUMENT_PAGE_TEXT_LAYER_METHOD,
    extractionVersion: "pdfjs-dist/6.2.108",
    textSha256: `text:${text}`,
    unreadReason,
  };
}

function vision(
  text: string,
  unreadReason: DocumentPageUnreadReason | null = null,
): DocumentPageReadingWrite {
  return {
    text,
    extractionMethod: DOCUMENT_PAGE_VISION_METHOD,
    extractionVersion: "gpt-5.4-mini+codex-cli/test",
    textSha256: `vision:${text}`,
    unreadReason,
  };
}

const untouched = { alreadyRead: false, readByAnalysis: false };
const read = { alreadyRead: true, readByAnalysis: false };

test("a page the analysis reads exactly as it is stored is left alone", () => {
  const stored = textLayer("letterhead");
  assert.equal(pageWriteDecision(stored, textLayer("letterhead"), untouched), "stored");
  assert.equal(pageWriteDecision(stored, textLayer("letterhead"), read), "stored");
});

test("a picture page nothing was read from becomes the transcription of it", () => {
  assert.equal(
    pageWriteDecision(textLayer("letterhead", "vision_unavailable"), vision("curve"), untouched),
    "reread",
  );
  // A transcription that came back different is still a page nothing was read from.
  assert.equal(pageWriteDecision(vision("curve"), vision("curve again"), untouched), "reread");
});

test("a text page whose text merely differs is a conflict, read from or not", () => {
  // Nothing narrows here: two text passes over one page must agree, and a difference is a
  // defect to surface rather than a reading to store.
  assert.equal(pageWriteDecision(textLayer("one"), textLayer("other"), untouched), "conflict");
  assert.equal(pageWriteDecision(textLayer("one"), textLayer("other"), read), "conflict");
});

test("a page something was read from keeps its stored reading and its reason", () => {
  assert.equal(pageWriteDecision(textLayer("letterhead"), vision("curve"), read), "conflict");
  assert.equal(
    pageWriteDecision(textLayer("letterhead"), textLayer("letterhead", "image_page_limit"), read),
    "conflict",
  );
});

test("the reason beside a page moves while nothing has been read from it", () => {
  assert.equal(
    pageWriteDecision(textLayer("letterhead"), textLayer("letterhead", "vision_unavailable"), {
      alreadyRead: false,
      readByAnalysis: true,
    }),
    "reread",
  );
  assert.equal(
    pageWriteDecision(textLayer("letterhead", "image_page_limit"), textLayer("letterhead"), {
      alreadyRead: false,
      readByAnalysis: false,
    }),
    "reread",
  );
});

test("a later text pass never un-reads what a vision pass transcribed", () => {
  const transcribed = vision("curve");
  assert.equal(pageWriteDecision(transcribed, textLayer("letterhead"), untouched), "stored");
  assert.equal(pageWriteDecision(transcribed, textLayer("letterhead"), read), "stored");
  // Unless this very analysis read a fact off that page: its fragment cites the text layer,
  // which the stored transcription is not, so the two cannot both be true.
  assert.equal(
    pageWriteDecision(transcribed, textLayer("letterhead"), {
      alreadyRead: true,
      readByAnalysis: true,
    }),
    "conflict",
  );
});
