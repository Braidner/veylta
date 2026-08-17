import {
  ASSISTANT_SPECIALTIES,
  type AssistantInvitation,
  type AssistantSpecialty,
  MAX_CONSILIUM_SPECIALISTS,
} from "@veylta/contracts";
import type { AssistantEvidence } from "./evidence.js";

/**
 * Who joins the консилиум is decided from the evidence, not by the model: a household table
 * from catalog codes to the specialty that reads them. The therapist owns everything else
 * (inflammation markers, proteins, vitamins) and the synthesis. Sex hormones go to the
 * gynecologist or the urologist by the recorded sex, to the endocrinologist when it is unknown.
 */
const specialtyByCode: Readonly<Record<string, AssistantSpecialty | "sex_hormones">> = {
  glucose: "endocrinologist",
  hba1c: "endocrinologist",
  insulin: "endocrinologist",
  tsh: "endocrinologist",
  "t4.free": "endocrinologist",
  "t3.free": "endocrinologist",
  "t4.total": "endocrinologist",
  "t3.total": "endocrinologist",
  "anti-tpo": "endocrinologist",
  "anti-tg": "endocrinologist",
  prolactin: "endocrinologist",
  cortisol: "endocrinologist",
  pth: "endocrinologist",
  "calcium.total": "endocrinologist",
  "calcium.ionized": "endocrinologist",
  "cholesterol.total": "cardiologist",
  "cholesterol.hdl": "cardiologist",
  "cholesterol.ldl": "cardiologist",
  "cholesterol.vldl": "cardiologist",
  "cholesterol.non-hdl": "cardiologist",
  triglycerides: "cardiologist",
  ck: "cardiologist",
  alt: "gastroenterologist",
  ast: "gastroenterologist",
  ggt: "gastroenterologist",
  alp: "gastroenterologist",
  "bilirubin.direct": "gastroenterologist",
  "bilirubin.indirect": "gastroenterologist",
  amylase: "gastroenterologist",
  "amylase.pancreatic": "gastroenterologist",
  lipase: "gastroenterologist",
  leukocytes: "hematologist",
  erythrocytes: "hematologist",
  hemoglobin: "hematologist",
  hematocrit: "hematologist",
  mcv: "hematologist",
  mch: "hematologist",
  mchc: "hematologist",
  "rdw.cv": "hematologist",
  "rdw.sd": "hematologist",
  platelets: "hematologist",
  mpv: "hematologist",
  pdw: "hematologist",
  pct: "hematologist",
  "p-lcr": "hematologist",
  "neutrophils.relative": "hematologist",
  "neutrophils.absolute": "hematologist",
  "neutrophils.band.relative": "hematologist",
  "neutrophils.segmented.relative": "hematologist",
  "lymphocytes.relative": "hematologist",
  "lymphocytes.absolute": "hematologist",
  "monocytes.relative": "hematologist",
  "monocytes.absolute": "hematologist",
  "eosinophils.relative": "hematologist",
  "eosinophils.absolute": "hematologist",
  "basophils.relative": "hematologist",
  "basophils.absolute": "hematologist",
  "reticulocytes.relative": "hematologist",
  "blasts.relative": "hematologist",
  "promyelocytes.relative": "hematologist",
  "myelocytes.relative": "hematologist",
  "metamyelocytes.relative": "hematologist",
  "plasma-cells.relative": "hematologist",
  iron: "hematologist",
  ferritin: "hematologist",
  transferrin: "hematologist",
  "transferrin-saturation": "hematologist",
  tibc: "hematologist",
  uibc: "hematologist",
  "vitamin-b12": "hematologist",
  folate: "hematologist",
  "prothrombin-time": "hematologist",
  aptt: "hematologist",
  fibrinogen: "hematologist",
  "d-dimer": "hematologist",
  creatinine: "nephrologist",
  urea: "nephrologist",
  "uric-acid": "nephrologist",
  sodium: "nephrologist",
  potassium: "nephrologist",
  chloride: "nephrologist",
  magnesium: "nephrologist",
  phosphorus: "nephrologist",
  "testosterone.total": "sex_hormones",
  estradiol: "sex_hormones",
  progesterone: "sex_hormones",
  lh: "sex_hormones",
  fsh: "sex_hormones",
  "psa.total": "urologist",
  "psa.free": "urologist",
};

function sexHormoneSpecialist(evidence: AssistantEvidence): AssistantSpecialty {
  const sex = evidence.medicalProfile.entries.find((entry) => entry.kind === "sex")?.value;
  return sex === "female" ? "gynecologist" : sex === "male" ? "urologist" : "endocrinologist";
}

/**
 * The specialists the evidence calls for, largest field first (ties in the specialties'
 * catalogue order, so the panel reads the same whatever order the values were confirmed in),
 * capped; each with the observations that invited them.
 */
export function consiliumPanel(evidence: AssistantEvidence): AssistantInvitation[] {
  const byId = new Map<AssistantSpecialty, string[]>();
  for (const observation of evidence.observations) {
    if (observation.code === null) continue;
    const mapped = specialtyByCode[observation.code];
    if (mapped === undefined) continue;
    const specialty = mapped === "sex_hormones" ? sexHormoneSpecialist(evidence) : mapped;
    const ids = byId.get(specialty) ?? [];
    ids.push(observation.observationId);
    byId.set(specialty, ids);
  }
  return [...byId.entries()]
    .map(([specialty, observationIds]) => ({ specialty, observationIds }))
    .sort(
      (a, b) =>
        b.observationIds.length - a.observationIds.length ||
        ASSISTANT_SPECIALTIES.indexOf(a.specialty) - ASSISTANT_SPECIALTIES.indexOf(b.specialty),
    )
    .slice(0, MAX_CONSILIUM_SPECIALISTS);
}
