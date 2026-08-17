// Writes fixtures/veylta-synthetic-discharge-note.pdf: a one-page synthetic discharge note in the
// RECORD grammar the fake codex and the API-side test double read (RECORD|kind|label|detail).
// The PDF carries a cp1251-shaped /Differences encoding of Cyrillic glyph names over Helvetica,
// which is enough for pdf.js text extraction; nothing here is real medical data.
//
//   node scripts/synthetic-discharge-fixture.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

// Adobe glyph names: А..Е = afii10017..10022, Ё = afii10023, Ж..Я = afii10024..10049;
// а..е = afii10065..10070, ё = afii10071, ж..я = afii10072..10097.
const upperName = (i) => `afii${i <= 5 ? 10017 + i : 10018 + i}`;
const lowerName = (i) => `afii${i <= 5 ? 10065 + i : 10066 + i}`;
const differences = [
  "192",
  ...Array.from({ length: 32 }, (_, i) => `/${upperName(i)}`),
  "224",
  ...Array.from({ length: 32 }, (_, i) => `/${lowerName(i)}`),
  "168",
  "/afii10023",
  "184",
  "/afii10071",
];
const encoding = `<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [ ${differences.join(" ")} ] >>`;
const punctuation = new Map([
  ["—", 0x97],
  ["–", 0x96],
  ["«", 0xab],
  ["»", 0xbb],
  ["·", 0xb7],
  ["Ё", 0xa8],
  ["ё", 0xb8],
]);

function bytesOf(text) {
  return [...text].map((ch) => {
    const code = ch.codePointAt(0);
    if (punctuation.has(ch)) return punctuation.get(ch);
    if (code >= 0x410 && code <= 0x42f) return 0xc0 + (code - 0x410);
    if (code >= 0x430 && code <= 0x44f) return 0xe0 + (code - 0x430);
    if (code < 0x80) return code;
    throw new Error(`no byte for ${ch}`);
  });
}

const escapeByte = (b) =>
  b === 0x28 || b === 0x29 || b === 0x5c
    ? `\\${String.fromCharCode(b)}`
    : b < 0x20 || b > 0x7e
      ? `\\${b.toString(8).padStart(3, "0")}`
      : String.fromCharCode(b);

export function syntheticNotePdf(lines) {
  const objects = [];
  const add = (body) => objects.push(body);
  const encodingObject = add(encoding);
  const font = add(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding ${encodingObject} 0 R >>`,
  );
  const commands = ["BT", "/F1 11 Tf", "56 780 Td", "14 TL"];
  lines.forEach((line, index) => {
    if (index > 0) commands.push("T*");
    commands.push(`(${bytesOf(line).map(escapeByte).join("")}) Tj`);
  });
  commands.push("ET");
  const stream = commands.join("\n");
  const content = add(
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  );
  const pages = objects.length + 2;
  const page = add(
    `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
  );
  add(`<< /Type /Pages /Kids [ ${page} 0 R ] /Count 1 >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pages} 0 R >>`);
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
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
