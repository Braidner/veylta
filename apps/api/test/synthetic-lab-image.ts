import { createCanvas } from "@napi-rs/canvas";

export type SyntheticLabImageFormat = "png" | "jpeg";

export function createSyntheticLabImage(
  lines: readonly string[],
  format: SyntheticLabImageFormat = "png",
): Buffer {
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

  return format === "png" ? canvas.toBuffer("image/png") : canvas.toBuffer("image/jpeg", 100);
}
