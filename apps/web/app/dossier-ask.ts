import {
  ASSISTANT_SPECIALTIES,
  type AssistantConversationPurpose,
  type AssistantSpecialty,
} from "@veylta/contracts";
import { specialtyLabel } from "./assistant";
import { type DossierSeries, seriesAssessment } from "./dossier";

/** Whom the dossier sends a question to: one specialist (the therapist included) or the консилиум. */
export type DossierAsk = AssistantSpecialty | "consilium";

const specialties: ReadonlySet<string> = new Set(ASSISTANT_SPECIALTIES);

export function parseAsk(value: string | undefined): DossierAsk | null {
  if (value === undefined) return null;
  return value === "consilium" || specialties.has(value) ? (value as DossierAsk) : null;
}

export function askPurpose(ask: DossierAsk): AssistantConversationPurpose {
  return `dossier:${ask}`;
}

const capitalize = (label: string) => label.charAt(0).toLocaleUpperCase("ru-RU") + label.slice(1);

/** «Досье · Кардиолог», «Досье · Консилиум» — the conversation the dossier keeps per addressee. */
export function askConversationTitle(ask: DossierAsk): string {
  return `Досье · ${ask === "consilium" ? "Консилиум" : capitalize(specialtyLabel[ask])}`;
}

/** Whom the message is addressed to: a persona, or nobody (the therapist's own thread). */
export function askAddressee(ask: DossierAsk): AssistantSpecialty | null {
  return ask === "consilium" || ask === "therapist" ? null : ask;
}

const dative: Record<AssistantSpecialty, string> = {
  therapist: "терапевту",
  endocrinologist: "эндокринологу",
  cardiologist: "кардиологу",
  gastroenterologist: "гастроэнтерологу",
  hematologist: "гематологу",
  nephrologist: "нефрологу",
  gynecologist: "гинекологу",
  urologist: "урологу",
  neurologist: "неврологу",
  dermatologist: "дерматологу",
  pulmonologist: "пульмонологу",
  rheumatologist: "ревматологу",
  oncologist: "онкологу",
  infectious_disease: "инфекционисту",
  dietitian: "диетологу",
  physiotherapist: "физиотерапевту",
  psychiatrist: "психиатру",
  emergency: "врачу неотложной помощи",
  other: "профильному специалисту",
};

/** One finding as the dossier read it: «ТТГ 9,9 мМЕ/л — выше референса (0,4 - 4,0), с прошлого раза +1,8, второй раз подряд вне референса». */
function findingCopy(series: DossierSeries): string {
  const assessment = seriesAssessment(series);
  const headline =
    assessment.headline.charAt(0).toLocaleLowerCase("ru-RU") + assessment.headline.slice(1);
  const parts = [`${series.name} ${series.latest.printed} ${series.unit} — ${headline}`];
  if (series.delta !== null) parts.push(assessment.movement);
  if (assessment.repeat.length > 0) parts.push(assessment.repeat);
  return parts.join(", ");
}

/**
 * The question the dossier puts into the composer — the person still reads it and sends it.
 * A specialist gets the group's findings; the консилиум gets everything outside its reference.
 */
export function askQuestion(ask: DossierAsk, findings: readonly DossierSeries[]): string {
  const list = findings.map(findingCopy).join("; ");
  if (ask === "consilium") {
    return list.length === 0
      ? "Что в моём досье требует внимания в первую очередь и насколько срочно?"
      : `Что в моём досье требует внимания в первую очередь и насколько срочно? Вне референса: ${list}.`;
  }
  if (list.length === 0) return fallbackQuestion(ask);
  return `Насколько срочно показать ${dative[ask]} эти значения из моего досье: ${list}? Что стоит уточнить до визита?`;
}

/** When the handoff is gone (a reload, another tab): the persona reads the evidence anyway. */
export function fallbackQuestion(ask: DossierAsk): string {
  return ask === "consilium"
    ? "Что в моём досье требует внимания в первую очередь и насколько срочно?"
    : `Насколько срочно показать ${dative[ask]} значения вне референса из моего досье? Что стоит уточнить до визита?`;
}

export interface DossierAskHandoff {
  readonly ask: DossierAsk;
  readonly question: string;
}

/** The narrowest storage the handoff needs; `window.sessionStorage` satisfies it. */
export interface HandoffStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const handoffKey = (profileId: string) => `veylta:dossier-ask:${profileId}`;

/** The dossier leaves the question for the assistant page in the browser — never in the URL. */
export function stashDossierAsk(
  storage: HandoffStorage,
  profileId: string,
  handoff: DossierAskHandoff,
): void {
  storage.setItem(handoffKey(profileId), JSON.stringify(handoff));
}

/** Read once and cleared, and only when it was left for this profile and this addressee. */
export function takeDossierAsk(
  storage: HandoffStorage,
  profileId: string,
  ask: DossierAsk,
): DossierAskHandoff | null {
  const raw = storage.getItem(handoffKey(profileId));
  if (raw === null) return null;
  storage.removeItem(handoffKey(profileId));
  try {
    const parsed = JSON.parse(raw) as Partial<DossierAskHandoff>;
    if (parsed.ask !== ask || typeof parsed.question !== "string") return null;
    return { ask, question: parsed.question };
  } catch {
    return null;
  }
}
