import { deflateSync } from "node:zlib";
import { createCanvas } from "@napi-rs/canvas";

export function createSyntheticImageOnlyPdf(lines: readonly string[]): Buffer {
  const width = 1_500;
  const height = 1_100;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "black";
  context.font = "34px monospace";
  for (const [index, line] of lines.entries()) {
    context.fillText(line, 50, 85 + index * 96);
  }

  const rgba = context.getImageData(0, 0, width, height).data;
  const rgb = Buffer.allocUnsafe(width * height * 3);
  for (let source = 0, target = 0; source < rgba.byteLength; source += 4, target += 3) {
    rgb[target] = rgba[source] ?? 0;
    rgb[target + 1] = rgba[source + 1] ?? 0;
    rgb[target + 2] = rgba[source + 2] ?? 0;
  }
  const compressed = deflateSync(rgb);
  const content = Buffer.from(`q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`, "ascii");
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "ascii"),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`,
      "ascii",
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${content.byteLength} >>\nstream\n`, "ascii"),
      content,
      Buffer.from("endstream", "ascii"),
    ]),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.byteLength} >>\nstream\n`,
        "ascii",
      ),
      compressed,
      Buffer.from("\nendstream", "ascii"),
    ]),
  ];
  const chunks: Buffer[] = [Buffer.from("%PDF-1.7\n", "ascii")];
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets[index + 1] = Buffer.concat(chunks).byteLength;
    chunks.push(
      Buffer.from(`${index + 1} 0 obj\n`, "ascii"),
      body,
      Buffer.from("\nendobj\n", "ascii"),
    );
  }
  const xrefOffset = Buffer.concat(chunks).byteLength;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, "ascii"));
  for (const offset of offsets.slice(1)) {
    chunks.push(Buffer.from(`${String(offset).padStart(10, "0")} 00000 n \n`, "ascii"));
  }
  chunks.push(
    Buffer.from(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
      "ascii",
    ),
  );
  return Buffer.concat(chunks);
}
