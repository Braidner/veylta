// Writes fixtures/veylta-synthetic-image-page-report.pdf: two pages of a laboratory that does not
// exist. Page 1 prints its values as text in the FACT grammar the fake codex and the API-side test
// double read. Page 2 is the picture page — a header and a caption in the text layer, and the
// curve itself painted as a raster image carrying no printed numbers. That is the shape a real
// densitometry page has, and the shape `imageOnlyPages` exists to notice.
//
//   node scripts/synthetic-image-page-fixture.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assemblePdf, CYRILLIC_ENCODING, streamObject, textObject } from "./synthetic-pdf.mjs";

export const SYNTHETIC_IMAGE_PAGE_TEXT_LINES = [
  "VEYLTA SYNTHETIC LAB REPORT v1",
  "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE",
  "Лаборатория «Синтез-Меридиан» (синтетическая)",
  "Дата: 2026-08-14",
  "FACT|synthetic-analyte-a",
  "NAME|СИНТЕТИЧЕСКИЙ АНАЛИТ A",
  "VALUE|7.0",
  "UNIT|synthetic-unit",
  "RANGE|5.0–8.0 synthetic-unit",
  "CONFIDENCE|0.95",
  "ISSUES|NONE",
  "END",
  "FACT|synthetic-analyte-b",
  "NAME|СИНТЕТИЧЕСКИЙ АНАЛИТ B",
  "VALUE|12.5",
  "UNIT|synthetic-unit",
  "RANGE|10.0–15.0 synthetic-unit",
  "CONFIDENCE|0.95",
  "ISSUES|NONE",
  "END",
];

/** Everything this page says in text; the curve below it is drawn, and prints no numbers. */
export const SYNTHETIC_IMAGE_PAGE_CAPTION_LINES = [
  "Лаборатория «Синтез-Меридиан» (синтетическая)",
  "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE",
  "Пациент: синтетический · Карта S-0001 · Страница 2 из 2",
  "Рисунок 1. Денситограмма (синтетическая кривая)",
  "Числовые значения на этой странице не напечатаны.",
];

const imageWidth = 200;
const imageHeight = 120;
// A densitometry trace: one tall band and four low ones, drawn, never printed as numbers.
const bands = [
  { center: 0.17, height: 0.95, spread: 0.05 },
  { center: 0.41, height: 0.24, spread: 0.04 },
  { center: 0.55, height: 0.33, spread: 0.045 },
  { center: 0.71, height: 0.27, spread: 0.04 },
  { center: 0.87, height: 0.46, spread: 0.05 },
];

function densitogramPixels() {
  const pixels = Buffer.alloc(imageWidth * imageHeight, 255);
  const baseline = imageHeight - 6;
  for (let x = 0; x < imageWidth; x += 1) {
    pixels[baseline * imageWidth + x] = 150;
    const position = x / (imageWidth - 1);
    const value = bands.reduce(
      (sum, band) =>
        sum + band.height * Math.exp(-((position - band.center) ** 2) / (2 * band.spread ** 2)),
      0,
    );
    const row = Math.round(baseline - Math.min(value, 1) * (baseline - 6));
    for (let pen = -1; pen <= 1; pen += 1) {
      const inked = row + pen;
      if (inked >= 0 && inked < imageHeight) pixels[inked * imageWidth + x] = 40;
    }
  }
  return pixels;
}

export function syntheticImagePagePdf() {
  const objects = [];
  const add = (body) => objects.push(body);
  const encoding = add(CYRILLIC_ENCODING);
  const font = add(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding ${encoding} 0 R >>`,
  );
  const image = add(
    streamObject(
      densitogramPixels().toString("latin1"),
      `/Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceGray /BitsPerComponent 8 `,
    ),
  );
  const pages = add("");
  const resources = (withImage) =>
    `<< /Font << /F1 ${font} 0 R >>${withImage ? ` /XObject << /Im1 ${image} 0 R >>` : ""} >>`;
  const pageObject = (contents, withImage) =>
    `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 595 842] /Resources ${resources(withImage)} /Contents ${contents} 0 R >>`;

  const textContents = add(streamObject(textObject(SYNTHETIC_IMAGE_PAGE_TEXT_LINES)));
  const textPage = add(pageObject(textContents, false));
  const pictureContents = add(
    streamObject(
      [
        "q 400 0 0 240 98 360 cm",
        "/Im1 Do",
        "Q",
        textObject(SYNTHETIC_IMAGE_PAGE_CAPTION_LINES),
      ].join("\n"),
    ),
  );
  const picturePage = add(pageObject(pictureContents, true));
  objects[pages - 1] = `<< /Type /Pages /Kids [ ${textPage} 0 R ${picturePage} 0 R ] /Count 2 >>`;
  return assemblePdf(objects, add(`<< /Type /Catalog /Pages ${pages} 0 R >>`));
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  const target = fileURLToPath(
    new URL("../fixtures/veylta-synthetic-image-page-report.pdf", import.meta.url),
  );
  writeFileSync(target, syntheticImagePagePdf());
  console.log(`wrote ${target}`);
}
