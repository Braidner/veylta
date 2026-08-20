// Writes fixtures/veylta-synthetic-discharge-note.pdf: a one-page synthetic discharge note in the
// RECORD grammar the fake codex and the API-side test double read (RECORD|kind|label|detail).
// The PDF carries a cp1251-shaped /Differences encoding of Cyrillic glyph names over Helvetica,
// which is enough for pdf.js text extraction; nothing here is real medical data.
//
//   node scripts/synthetic-discharge-fixture.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assemblePdf, CYRILLIC_ENCODING, streamObject, textObject } from "./synthetic-pdf.mjs";

export const SYNTHETIC_DISCHARGE_LINES = [
  "VEYLTA SYNTHETIC DISCHARGE NOTE v1",
  "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE",
  "Выписной эпикриз (синтетический)",
  "Дата: 2026-08-12",
  "RECORD|diagnosis|Синтетический субклинический гипотиреоз|E03.9",
  "RECORD|medication|Синтетический левотироксин|25 мкг утром, 8 недель",
  "RECORD|referral|Консультация эндокринолога|через 6 недель",
  "RECORD|follow_up|Повторить ТТГ и Т4 свободный|через 6 недель",
  "RECORD|finding|Щитовидная железа не увеличена, узлов нет|УЗИ синтетическое",
  "END",
];

export function syntheticNotePdf(lines) {
  const objects = [];
  const add = (body) => objects.push(body);
  const encodingObject = add(CYRILLIC_ENCODING);
  const font = add(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding ${encodingObject} 0 R >>`,
  );
  const content = add(streamObject(textObject(lines)));
  const pages = objects.length + 2;
  const page = add(
    `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
  );
  add(`<< /Type /Pages /Kids [ ${page} 0 R ] /Count 1 >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pages} 0 R >>`);
  return assemblePdf(objects, catalog);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  const target = fileURLToPath(
    new URL("../fixtures/veylta-synthetic-discharge-note.pdf", import.meta.url),
  );
  writeFileSync(target, syntheticNotePdf(SYNTHETIC_DISCHARGE_LINES));
  console.log(`wrote ${target}`);
}
