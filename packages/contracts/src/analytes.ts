import type { AssistantSpecialty } from "./assistant.js";

/**
 * The household's reading of its own analyte codes: which area of the record a code belongs to
 * (how the dossier groups indicators) and which specialty reads it (who a finding is referred to
 * and who joins the консилиум). One table for the API and the web; codes are household
 * identifiers from the analyte catalog, not a clinical vocabulary. Sex hormones are read by the
 * gynecologist or the urologist depending on the recorded sex, by the endocrinologist when it is
 * unknown.
 */
export const ANALYTE_AREAS = [
  "blood",
  "iron",
  "coagulation",
  "lipids",
  "liver",
  "pancreas",
  "kidney",
  "electrolytes",
  "glucose",
  "thyroid",
  "hormones",
  "inflammation",
  "protein",
  "vitamins",
  "prostate",
  "other",
] as const;

export type AnalyteArea = (typeof ANALYTE_AREAS)[number];

interface AnalyteReading {
  readonly area: AnalyteArea;
  readonly specialty: AssistantSpecialty | "sex_hormones" | null;
}

const reading = (
  area: AnalyteArea,
  specialty: AssistantSpecialty | "sex_hormones" | null,
): AnalyteReading => ({ area, specialty });

const bloodCount = reading("blood", "hematologist");
const iron = reading("iron", "hematologist");
const coagulation = reading("coagulation", "hematologist");
const lipids = reading("lipids", "cardiologist");
const liver = reading("liver", "gastroenterologist");
const pancreas = reading("pancreas", "gastroenterologist");
const kidney = reading("kidney", "nephrologist");
const electrolytes = reading("electrolytes", "nephrologist");
const glucose = reading("glucose", "endocrinologist");
const thyroid = reading("thyroid", "endocrinologist");
const endocrine = reading("hormones", "endocrinologist");
const sexHormones = reading("hormones", "sex_hormones");
const inflammation = reading("inflammation", null);
const protein = reading("protein", null);
const vitamins = reading("vitamins", null);
const prostate = reading("prostate", "urologist");

export const ANALYTE_READINGS: Readonly<Record<string, AnalyteReading>> = {
  leukocytes: bloodCount,
  erythrocytes: bloodCount,
  hemoglobin: bloodCount,
  hematocrit: bloodCount,
  mcv: bloodCount,
  mch: bloodCount,
  mchc: bloodCount,
  "rdw.cv": bloodCount,
  "rdw.sd": bloodCount,
  platelets: bloodCount,
  mpv: bloodCount,
  pdw: bloodCount,
  pct: bloodCount,
  "p-lcr": bloodCount,
  esr: reading("inflammation", null),
  "neutrophils.relative": bloodCount,
  "neutrophils.absolute": bloodCount,
  "neutrophils.band.relative": bloodCount,
  "neutrophils.segmented.relative": bloodCount,
  "lymphocytes.relative": bloodCount,
  "lymphocytes.absolute": bloodCount,
  "monocytes.relative": bloodCount,
  "monocytes.absolute": bloodCount,
  "eosinophils.relative": bloodCount,
  "eosinophils.absolute": bloodCount,
  "basophils.relative": bloodCount,
  "basophils.absolute": bloodCount,
  "reticulocytes.relative": bloodCount,
  "blasts.relative": bloodCount,
  "promyelocytes.relative": bloodCount,
  "myelocytes.relative": bloodCount,
  "metamyelocytes.relative": bloodCount,
  "plasma-cells.relative": bloodCount,
  iron,
  ferritin: iron,
  transferrin: iron,
  "transferrin-saturation": iron,
  tibc: iron,
  uibc: iron,
  "vitamin-b12": reading("vitamins", "hematologist"),
  folate: reading("vitamins", "hematologist"),
  "vitamin-d": vitamins,
  "prothrombin-time": coagulation,
  aptt: coagulation,
  fibrinogen: coagulation,
  "d-dimer": coagulation,
  "cholesterol.total": lipids,
  "cholesterol.hdl": lipids,
  "cholesterol.ldl": lipids,
  "cholesterol.vldl": lipids,
  "cholesterol.non-hdl": lipids,
  triglycerides: lipids,
  ck: reading("liver", "cardiologist"),
  alt: liver,
  ast: liver,
  ggt: liver,
  alp: liver,
  ldh: reading("liver", null),
  "bilirubin.total": liver,
  "bilirubin.direct": liver,
  "bilirubin.indirect": liver,
  amylase: pancreas,
  "amylase.pancreatic": pancreas,
  lipase: pancreas,
  creatinine: kidney,
  urea: kidney,
  "uric-acid": kidney,
  sodium: electrolytes,
  potassium: electrolytes,
  chloride: electrolytes,
  magnesium: electrolytes,
  phosphorus: electrolytes,
  "calcium.total": reading("electrolytes", "endocrinologist"),
  "calcium.ionized": reading("electrolytes", "endocrinologist"),
  glucose,
  hba1c: glucose,
  insulin: glucose,
  tsh: thyroid,
  "t4.free": thyroid,
  "t3.free": thyroid,
  "t4.total": thyroid,
  "t3.total": thyroid,
  "anti-tpo": thyroid,
  "anti-tg": thyroid,
  prolactin: endocrine,
  cortisol: endocrine,
  pth: endocrine,
  "testosterone.total": sexHormones,
  estradiol: sexHormones,
  progesterone: sexHormones,
  lh: sexHormones,
  fsh: sexHormones,
  "psa.total": prostate,
  "psa.free": prostate,
  crp: inflammation,
  "total-protein": protein,
  albumin: protein,
};

export function analyteArea(code: string | null): AnalyteArea {
  return code === null ? "other" : (ANALYTE_READINGS[code]?.area ?? "other");
}

/** The specialty a finding on this analyte is referred to; null means the therapist keeps it. */
export function analyteSpecialty(
  code: string | null,
  sex: "female" | "male" | null,
): AssistantSpecialty | null {
  const specialty = code === null ? null : (ANALYTE_READINGS[code]?.specialty ?? null);
  if (specialty !== "sex_hormones") return specialty;
  return sex === "female" ? "gynecologist" : sex === "male" ? "urologist" : "endocrinologist";
}
