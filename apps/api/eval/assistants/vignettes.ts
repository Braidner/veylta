import type { Vignette } from "./vignette.js";
import { physicianVignettesA } from "./vignettes-physician-a.js";
import { physicianVignettesB } from "./vignettes-physician-b.js";
import { regimenVignettes } from "./vignettes-regimen.js";

/** The first set: 24 physician, 3 nutritionist, 3 trainer — all synthetic. */
export const vignettes: readonly Vignette[] = [
  ...physicianVignettesA,
  ...physicianVignettesB,
  ...regimenVignettes,
];
