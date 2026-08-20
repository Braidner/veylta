// Shared PDF plumbing for the synthetic fixture generators: a cp1251-shaped /Differences
// encoding of Cyrillic glyph names over Helvetica (enough for pdf.js text extraction), the
// escaping of one text line, and the xref/trailer assembly. Nothing here is medical data.

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
export const CYRILLIC_ENCODING = `<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [ ${differences.join(" ")} ] >>`;

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

/** One line of Russian text as the body of a PDF string literal, parentheses excluded. */
export function pdfLiteral(text) {
  return bytesOf(text).map(escapeByte).join("");
}

/** A text object that prints `lines` from the given origin, one line per row. */
export function textObject(lines, { x = 56, y = 780, size = 11, leading = 14 } = {}) {
  const commands = ["BT", `/F1 ${size} Tf`, `${x} ${y} Td`, `${leading} TL`];
  lines.forEach((line, index) => {
    if (index > 0) commands.push("T*");
    commands.push(`(${pdfLiteral(line)}) Tj`);
  });
  commands.push("ET");
  return commands.join("\n");
}

/** A content stream object body wrapping already-built page commands. */
export function streamObject(body, dictionary = "") {
  return `<< ${dictionary}/Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`;
}

/** Objects are 1-indexed by position; the file is assembled as latin1 so streams stay binary. */
export function assemblePdf(objects, catalogNumber) {
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNumber} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
