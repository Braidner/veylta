import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentTimelineEntry } from "@veylta/contracts";
import {
  effectiveDateCopy,
  mergeTimelinePages,
  monthLabel,
  nodeCounts,
  timelineGroups,
  timelineNodes,
} from "./document-timeline";

const entry = (
  id: string,
  value: string,
  source: "person" | "document" | "upload",
  counts = [0, 0, 0],
): DocumentTimelineEntry => ({
  id,
  originalFilename: `${id}.pdf`,
  contentType: "application/pdf",
  uploadedAt: "2026-08-19T10:00:00.000Z",
  effectiveDate: { value, source },
  category: "laboratory",
  title: null,
  shortSummary: null,
  confirmedCount: counts[0] ?? 0,
  outsideRangeCount: counts[1] ?? 0,
  recordCount: counts[2] ?? 0,
});

test("nodes group by month, newest first, with a year marker where the year changes", () => {
  const groups = timelineGroups(
    timelineNodes([
      entry("a", "2026-08-19", "upload"),
      entry("b", "2026-08-02", "document"),
      entry("c", "2026-05-14", "person"),
      entry("d", "2025-12-31", "document"),
    ]),
  );
  assert.deepEqual(
    groups.map((group) => [
      group.key,
      group.label,
      group.yearMarker,
      group.nodes.map((node) => node.id),
    ]),
    [
      ["2026-08", "Август 2026", "2026", ["a", "b"]],
      ["2026-05", "Май 2026", null, ["c"]],
      ["2025-12", "Декабрь 2025", "2025", ["d"]],
    ],
  );
  assert.equal(monthLabel("2026-01"), "Январь 2026");
});

test("the date reads as a day; the source shows only when it is not the document's own", () => {
  assert.deepEqual(effectiveDateCopy({ value: "2026-08-12", source: "document" }), {
    date: "12 августа 2026 г.",
    marker: null,
  });
  assert.deepEqual(effectiveDateCopy({ value: "2026-08-19", source: "upload" }), {
    date: "19 августа 2026 г.",
    marker: "по дате загрузки",
  });
  assert.deepEqual(effectiveDateCopy({ value: "2026-05-14", source: "person" }), {
    date: "14 мая 2026 г.",
    marker: "дата исправлена",
  });
});

test("counts are chips only when they say something", () => {
  assert.deepEqual(nodeCounts(entry("a", "2026-08-19", "upload", [3, 1, 2])), [
    "подтверждено 3",
    "вне референса: 1",
    "записи врача: 2",
  ]);
  assert.deepEqual(nodeCounts(entry("b", "2026-08-19", "upload", [1, 0, 0])), ["подтверждено 1"]);
  assert.deepEqual(nodeCounts(entry("c", "2026-08-19", "upload")), []);
});

test("pages merge without repeating a document", () => {
  const first = [entry("a", "2026-08-19", "upload"), entry("b", "2026-08-02", "document")];
  const next = [entry("b", "2026-08-02", "document"), entry("c", "2026-05-14", "person")];
  assert.deepEqual(
    mergeTimelinePages(first, next).map((item) => item.id),
    ["a", "b", "c"],
  );
});
