# Product

## Register

product

## Platform

web

## Users

The primary user is the administrator of a household Veylta server who keeps health documents for themselves and family members. Local users sign in to their own account and open a profile only when they own it, administer the installation, or hold an explicit grant. Dependent profiles have no independent sign-in.

Users may be reviewing unfamiliar medical language while worried or short on time. The interface must always make the active family member, the status of unconfirmed data, and the path back to the source document obvious.

## Product Purpose

Veylta is a home health-care PWA backed by SQLite and immutable source documents. It helps a household upload a result, review uncertain extraction, confirm facts — and then **accompanies the person**: it reads the confirmed record, says what it sees, names the likely explanations and the treatment a physician would consider, and turns every finding into a next step with a named specialist. It is a second opinion that walks with you, not a filing cabinet and not a clinician.

Everything Veylta says is a **recommendation that ends in a doctor's office**: every assessment, hypothesis and treatment option names the specialty that must confirm it and offers to put that visit into the plan. Veylta never presents a finding as a settled diagnosis or a prescription; it makes the case for the visit, keeps the evidence attached, and records what the doctor then said, so over time the household can see how the assessments and the clinicians' decisions compared.

Success means a person can see, on one screen, what in their record deserves attention and why, what to do next and with whom, verify every value against a specific page and fragment of the source, and control who may open each profile.

## Positioning

A second opinion that keeps you moving: every health value is understandable in context, independently traceable to the family's own source document, assessed for what it means, and answered with the next step.

## Brand Personality

Calm, exact, humane — and engaged. The product lowers cognitive load without softening uncertainty, uses plain language without patronizing, says plainly when something deserves attention, and communicates urgency exactly as the evidence supports it: neither alarm for routine review work nor reassurance it cannot justify.

## Anti-references

- One opaque or gamified "health score" standing in for the record.
- Black-box AI answers without dates, confidence, or provenance.
- Alarmist red states and false urgency for routine review work — and the opposite: a passive archive that never says what a value means.
- Clinic billing, scheduling, or EHR administration patterns imposed on a family tool.
- Decorative wellness imagery that competes with the user's actual documents and measurements.
- Generic server-admin dashboards that make the household member secondary.

## Design Principles

1. Source before interpretation: a value, assessment, or recommendation always has a visible path to evidence.
2. Every assessment ends in a next step: what it means, how much it can wait, which specialist confirms it, and one action to put that into the plan.
3. Uncertainty is a first-class state: low-confidence extraction requires an explicit human decision; a hypothesis carries its confidence; a refused answer says so by name.
4. The active person is never implicit: every screen makes the selected family profile clear, and their own dossier — sex, age, height, weight, conditions, medications — is where interpretation starts.
5. Progressive disclosure: lead with what deserves attention and the next useful action, then reveal raw, technical, and provenance details.
6. Familiar controls, careful language: interaction should disappear into the task while medical meaning stays precise.
7. Home-server clarity: account, storage, Codex runtime, and access settings must expose their actual local state without revealing secrets.

## What Veylta itself may say, and what only an assistant may

Two grades of statement, both recommendations, both ending in a referral:

- **Deterministic assessments** — Veylta's own rules over confirmed values and the person's dossier: a value outside its printed reference range or flagged by the laboratory; how it changed against the previous confirmed value and over the series; a finding that repeats; a value the dossier says to watch (a recorded condition, medication or pregnancy). Veylta states these plainly, marks how much they can wait, names the specialty the analyte belongs to (the same code→specialty table that convenes the консилиум) and offers the visit as a plan item. It never invents a number, never converts a unit, never sums findings into one index, and never claims a diagnosis from a rule.
- **Model assessments** — hypotheses, treatment options and questions for the visit come only from the assistants: verified block by block against the evidence, refuted by an independent run, each with its confidence, its `confirmWith` specialty and its urgency tier in fixed copy; no medication with a dose. A refused answer shows a closed reason, never a model sentence.
- Nothing either grade says becomes a plan item, an observation, or a record without a human action; the doctor's actual decision — recorded later — is what the assessment is measured against.

## Assistant Surfaces

- `ИИ-врач · второе мнение` is a real second opinion over the person's confirmed values and their own medical profile (docs/assistants.md). It answers only in typed, evidence-bound blocks — interpretation, hypothesis, treatment option, question for the visit, general knowledge, missing data — under a mandatory urgency tier rendered as fixed copy. Every hypothesis and treatment option names the specialty that must confirm it; a medication is never proposed with a dose; a second, independent run refutes each answer before it is shown; an answer that fails verification is refused with a closed reason. It is a recommendation for a conversation with a clinician, never a diagnosis or a prescription, and it interprets nothing until sex and birth year are recorded.
- The evidence that leaves the machine is disclosed verbatim in the egress notice and confirmed per conversation before the first message: confirmed observations with printed ranges, the medical profile, the care plan. Never a document, page or file. The raw exchange and the checker's verdict are journaled for the owner, like a run journal; nothing of it reaches logs, metrics or audit.
- «Собрать консилиум» convenes specialist personas the evidence itself names (a table from analyte codes to specialties, shown to the person as «в данных: ТТГ»), plus any the person adds; each persona reads the same evidence independently and is verified and refuted like the therapist; the therapist's synthesis takes the highest urgency, keeps every referral and names where the specialists agree and differ. Every opinion is shown beside the synthesis, so a disagreement is never averaged away; a chip lets the person ask one persona directly inside the same conversation. Nothing beyond the disclosed evidence leaves the machine for a консилиум.
- `ИИ-нутрициолог` is an assistant of the same kind in its own room: a diet assessment from the confirmed values and the profile, recommendations by category (structure, favour, limit, supplement by name or class — never a dose —, hydration, timing) each checked against the recorded conditions and medications and each naming who confirms it, and what to measure again and when; a recommendation the person accepts becomes a `nutrition` item, a recheck a `laboratory` item. `ИИ-тренер` is the third: an activity assessment from the same evidence, the recorded constraints and clearance, a programme with the load and progression in its own words (never a heart-rate number or a schedule Veylta computes), each activity stating whether it sits within the recorded clearance and naming who confirms it, and what to avoid and when to stop; an accepted activity becomes an `activity` item, one that needs clearance the visit that gives it. Under each accepted activity or nutrition item the person keeps their own diary — done or skipped, day by day, with a note — and the assistants read it as adherence, so progression follows what was actually done.
- No assistant sends unsolicited medical advice or silently changes the care plan. Accepting a referral or a proposal is a human action that creates one `clinician`/lane item; every proposal remains a draft until then.
- The dossier («Досье») is the person's page: their passport of recorded facts, the dynamics of every confirmed indicator with Veylta's deterministic assessment and the next step, the summary, the care plan and the assistants' latest read. Every assessment on it is a recommendation with a named specialist; none is a diagnosis, none is a single score.

## Accessibility & Inclusion

Target WCAG 2.2 AA as an engineering baseline, without claiming conformance before an audit. All core actions must work with a keyboard and screen reader, status must never rely on color alone, text and controls must retain strong contrast, touch targets must remain usable on mobile web, and reduced-motion preferences must be honored.
