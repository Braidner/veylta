import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentPageReading } from "@veylta/contracts";
import { pageReadingNotes, pageReadingSummary } from "./document-pages";

function page(
  pageNumber: number,
  extractionMethod: string,
  unreadReason: DocumentPageReading["unreadReason"] = null,
): DocumentPageReading {
  return { pageNumber, extractionMethod, unreadReason };
}

test("a page read from the text layer has nothing of its own to say", () => {
  assert.deepEqual(pageReadingNotes([page(1, "pdf_text_layer"), page(2, "pdf_text_layer")]), []);
});

test("a page the vision pass transcribed says its picture was read", () => {
  const notes = pageReadingNotes([page(1, "pdf_text_layer"), page(2, "codex_vision")]);

  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.pageNumber, 2);
  assert.equal(notes[0]?.kind, "read");
  assert.equal(notes[0]?.label, "Рисунок прочитан");
  assert.match(notes[0]?.detail ?? "", /расшифров/);
});

test("an unread picture names the closed reason it was not read for", () => {
  const notes = pageReadingNotes([
    page(2, "pdf_text_layer", "vision_unavailable"),
    page(3, "pdf_text_layer", "image_page_limit"),
  ]);

  assert.deepEqual(
    notes.map((note) => [note.pageNumber, note.kind, note.label, note.detail]),
    [
      [
        2,
        "unread",
        "Рисунок не прочитан",
        "Разбор изображения не завершился. Данных с рисунка в документе нет.",
      ],
      [
        3,
        "unread",
        "Рисунок не прочитан",
        "В один разбор поместились не все страницы с рисунками. Данных с рисунка в документе нет.",
      ],
    ],
  );
});

test("an unread page outranks the transcription it never got", () => {
  const notes = pageReadingNotes([page(2, "codex_vision", "vision_unavailable")]);

  assert.deepEqual(
    notes.map((note) => note.kind),
    ["unread"],
  );
});

test("the summary counts the pages and says what read them", () => {
  assert.equal(pageReadingSummary([]), null);
  assert.equal(pageReadingSummary([page(1, "pdf_text_layer")]), "1 страница · текстовый слой");
  assert.equal(
    pageReadingSummary([page(1, "pdf_text_layer"), page(2, "codex_vision")]),
    "2 страницы · текстовый слой и разбор изображения",
  );
  assert.equal(
    pageReadingSummary([page(1, "codex_vision"), page(2, "codex_vision")]),
    "2 страницы · разбор изображения",
  );
  assert.equal(
    pageReadingSummary([page(1, "pdf_text_layer"), page(2, "pdf_text_layer", "image_page_limit")]),
    "2 страницы · текстовый слой",
  );
});
